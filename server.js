var fs = require('fs'),
	dns = require('dns'),
	zlib = require('zlib'),
	util = require('util'),
	path = require('path'),
	http = require('http'),
	https = require('https'),
	stream = require('stream'),
	crypto = require('crypto'),
	webpack = require('webpack'),
	cookies = require('./cookies'),
	nodehttp = require('sys-nodehttp'),
	WebSocket = require('ws');

module.exports = class extends require('./index.js') {
	constructor(config){
		var rewriter = super(Object.assign({
			http_agent: null,
			https_agent: new https.Agent({ rejectUnauthorized: false }),
			interface: null,
		}, config));
		
		if(this.config.server){
			this.webpack = webpack({
				entry: path.join(__dirname, 'browser.js'),
				output: { path: path.join(__dirname, 'bundle'), filename: 'main.js' },
				devtool: 'source-map',
				plugins: [
					new webpack.DefinePlugin({
						PRODUCTION: true,
						inject_config: JSON.stringify({
							codec: this.config.codec.name,
							prefix: this.config.prefix,
							title: this.config.title,
							ws: this.config.ws,
							minify_js: this.config.minify_js,
						}),
					}),
				],
			}, (err, stats) => {
				if(err)return console.error(err);
				
				this.webpack.watch({}, (err, stats) => {
					var error = !!(err || stats.compilation.errors.length);
					
					for(var ind = 0; ind < stats.compilation.errors.length; ind++)error = true, console.error(stats.compilation.errors[ind]);
					if(err)console.error(err);
					
					if(error)return console.error('One or more errors occured during bundling, refer to above console output for more info');
					
					console.log('Bundling success');
				});
			});
			
			this.config.server.get(this.config.prefix + '/favicon', async (req, res) => res.contentType('image/png').send(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAA', 'base64')));
			
			this.config.server.use(this.config.prefix + '/', nodehttp.static(this.webpack.options.output.path, {
				listing: [ '/' ],
				setHeaders(res){
					// acorn encoding
					res.set('content-type', res.headers.get('content-type') + ';charset=UTF-8');
				},
			}));
			
			this.config.server.all(this.config.prefix + '*', async (req, res, next) => {
				var url = this.valid_url(this.unurl(req.url.href, this.empty_meta));
				
				if(!url || !this.protocols.includes(url.protocol))return next('bad source url');
				
				var meta = { url: url, origin: req.url.origin, base: url.href },
					failure,
					timeout = setTimeout(() => !res.body_sent && (failure = true, res.error(500, 'Timeout')), this.config.timeout),
					ip = await dns.promises.lookup(url.hostname).catch(err => (failure = true, res.error(400, err)));
				
				if(failure)return next(failure);
				
				if(ip.address.match(this.regex.url.ip))return res.error(403, 'Forbidden IP');
				
				(url.protocol == 'http:' ? http : https).request({
					agent: url.protocol == 'http:' ? this.config.http_agent : this.config.https_agent,
					servername: url.hostname,
					hostname: ip.address,
					path: url.fullpath,
					port: url.port,
					protocol: url.protocol,
					localAddress: this.config.interface,
					headers: this.headers_encode(req.headers, meta),
					method: req.method,
				}, async resp => {
					var dest = req.headers['sec-fetch-dest'],
						decoded = this.decode_params(req.url),
						content_type = (resp.headers['content-type'] || '').split(';')[0],
						route = decoded.get('route'),
						dec_headers = this.headers_decode(resp.headers, meta);
					
					res.status(resp.statusCode);
					
					for(var name in dec_headers)res.set(name, dec_headers[name]);
					
					clearTimeout(timeout);
					
					if(failure)return;
					
					if(['js', 'css', 'html', 'manifest'].includes(route)){
						var body = await this.decompress(req, resp);
						
						try{
							var parsed = await this[route](body.toString(), meta, { inline: false, global: decoded.get('global') == true, mime: content_type });
						}catch(err){
							console.error(err);
							
							return res.error(500, err);
						}
						
						res.send(parsed);
					}else{
						var encoding = resp.headers['content-encoding'] || resp.headers['x-content-encoding'];
						
						if(encoding)res.set('content-encoding', encoding);
						
						res.pipe_from(resp);
					}
				}).on('error', err => {
					clearTimeout(timeout);
					
					if(failure || res.body_sent || res.head_sent)return;
					
					// todo: unsecure site warning
					// if([ 'TLS', 'INVALID' ].every(key => err.code.split('_').includes(key)))
					
					res.error(400, err);
				}).end(req.raw_body);
			});
			
			if(this.config.ws){
				var wss = new WebSocket.Server({ server: this.config.server.server });
				
				// use native alternative, websocket server cannot send back 404 if a 404 is recieved from connected server
				// active instances often show /itsgonnafail on domains throwing an error which may be a red flag that the site is under a proxy
				wss.on('connection', async (cli, req) => {
					var req_url = new this.URL(req.url, new this.URL('wss://' + req.headers.host)),
						url = this.unurl(req_url.href, this.empty_meta),
						cookis = cookies.parse_object(req.headers.cookie),
						meta = { url: url, origin: req_url.origin, base: url, id: cookis.proxy_id };
					
					if(!url)return cli.close();
					
					var srv = new WebSocket(url, cli.protocol, {
							headers: this.headers_encode(new nodehttp.headers(req.headers), meta),
							agent: ['wss:', 'https:'].includes(url.protocol) ? this.config.https_agent : this.config.http_agent,
						}),
						time = 8000,
						queue = [];
					
					cli.on('message', data => srv.readyState == WebSocket.OPEN && srv.send(data)).on('close', code => (srv.readyState == WebSocket.OPEN && srv.close()));
					
					srv.on('open', () => cli.send('sp$0')).on('message', data => cli.send(data)).on('close', code => cli.close()).on('error', err => {
						// client should read then close
						cli.send('sp$1');
						
						console.log('error at ' + url.href);
						console.error(err);
					});
				});
			}
		}
	}
	headers_encode(headers, meta){
		var out = {};
		
		headers.forEach((value, header) => {
			switch(header.toLowerCase()){
				case'referrer':
				case'referer':
					
					out[header] = this.unurl(value, meta);
					
					break;
				case'host':
					
					out[header] = new this.URL(meta.url).host;
					
					break;
				case'cookie': case'sec-websocket-key': break;
				case'origin':
					
					var valid = this.valid_url(this.unurl(headers.get('referer') || headers.get('referrer') || '', meta));
					
					if(valid)out.origin = out.Origin = valid.origin;
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = value;
					
					break;
			}
		});
		
		out['accept-encoding'] = 'gzip, deflate, br';
		
		out.host = new this.URL(meta.url).host;
		
		return out;
	}
	headers_decode(value, meta){
		var out = {};
		
		for(var header in value){
			var val = typeof value[header] == 'object' ? value[header].join(', ') : value[header],
				arr = Array.isArray(value[header]) ? value[header] : [ value[header] ];
			
			switch(header.toLowerCase()){
				case'set-cookie':
					
					break;
				case'location':
					
					out[header] = this.url(val, meta, { route: 'html' });
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = val;
					
					break;
			}
		};
		
		// full referrer
		out['referrer-policy'] = 'unsafe-url';
		
		return out;
	}
	decompress(req, res){
		var chunks = [];
		
		return new Promise((resolve, reject) => {
			if(req.method != 'HEAD' && res.statusCode != 204  && res.statusCode != 304)switch(res.headers['content-encoding'] || res.headers['x-content-encoding']){
				case'gzip':
					
					res = res.pipe(zlib.createGunzip({ flush: zlib.Z_SYNC_FLUSH, finishFlush: zlib.Z_SYNC_FLUSH }));
					
					break;
				case'deflate':
					return res.once('data', chunk =>
						res.pipe((chunk[0] & 0x0F) === 0x08 ? zlib.createInflate() : zlib.createInflateRaw()).on('data', chunk => chunks.push(chunk)).on('end', () => resolve(Buffer.concat(chunks)))
					);
					
					break;
				case'br':
					
					res = res.pipe(zlib.createBrotliDecompress());
					
					break;
			}
			
			res.on('data', chunk => chunks.push(chunk)).on('end', () => resolve(Buffer.concat(chunks))).on('error', err => console.error(err) + resolve(Buffer.concat(chunks)));
		});
	}
};