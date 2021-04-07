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
	webpack = require('webpack'),
	cookies = require('./cookies'),
	nodehttp = require('sys-nodehttp'),
	WebSocket = require('ws'),
	sqlite3 = class extends require('sqlite3').Database {
		constructor(...args){
			var callback = typeof args.slice(-1)[0] == 'function' && args.splice(-1)[0],
				promise = new Promise((resolve, reject) => super(...args, err => {
					var ind = this.wqueue.unknown.indexOf(promise);
					
					if(ind != -1)this.wqueue.unknown.splice(ind, 1);
					
					if(err)reject(err);
					else resolve();
				}));
			
			this.wqueue = { unknown: [ promise ] };
		}
		promisify(prop, [ query, ...args ]){
			var	split = query.split(' '),
				table = split.indexOf('from');
			
			if(table == -1)table = split.indexOf('into');
			
			if(table != -1)table = split[table + 1];
			else table = 'unknown';
			
			if(!this.wqueue[table])this.wqueue[table] = [];
			
			var promise = new Promise((resolve, reject) => Promise.allSettled(this.wqueue[table]).then(() => {
					var start = Date.now(), time;
					
					super[prop](query, ...args, (err, row, ind) => ((ind = this.wqueue[table].indexOf(promise)) != -1 && this.wqueue[table].splice(ind, 1), err ? reject(err) : resolve(row)));
					
					// console.error(query, '\n', err)
					
					time = Date.now() - start;
					
					if(time > 100)console.log(query + '\ntook ' + time + 'ms to execute, consider optimizing');
				}));
			
			this.wqueue[table].push(promise);
			
			return promise;
		}
		get(...args){
			return this.promisify('get', args);
		}
		all(...args){
			return this.promisify('all', args);
		}
		run(...args){
			return this.promisify('run', args);
		}
	},
	data = new sqlite3(path.join(__dirname, 'data.db'));

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
			
			this.config.server.use(this.config.prefix, async (req, res, next) => {
				req.meta_id = req.cookies.proxy_id;
				
				if(!req.meta_id)res.headers.append('set-cookie', 'proxy_id=' + (req.meta_id = await this.bytes()) + '; expires=' + new Date(Date.now() + 54e8).toGMTString());
				
				next();
			});
			
			this.config.server.post(this.config.prefix + '/cookie', async (req, res) => {
				var meta = { id: req.meta_id, url: this.valid_url(req.body.url) };
				
				// only works if table exists
				if(!meta.id || !(await data.run(`select * from "${meta.id}";`).then(() => true).catch(err => false)) || !meta.url || !req.body.value)return res.error(400, 'Invalid body');
				
				var parsed = cookies.parse_object(req.body.value, true);
				
				for(var name in parsed){
					var cookie = parsed[name],
						domain = cookie.domain || meta.url.host,
						got = await data.get(`select * from "${meta.id}" where domain = ?`, domain).catch(() => false),
						existing = got ? cookies.parse_object(got.value, true) : {};
					
					existing[name] = cookie;
					
					delete existing[name].name;
					
					await data.run(`insert or replace into "${meta.id}" (domain,value,access) values (?, ?, ?)`, got ? got.domain : domain, cookies.format_object(existing).join(' '), Date.now());
				}
				
				return res.status(200).end();
			});
			
			this.config.server.get(this.config.prefix + '/favicon', async (req, res) => {
				res.contentType('image/png').send(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAA', 'base64'));
			});
			
			this.config.server.use(this.config.prefix + '/', nodehttp.static(this.webpack.options.output.path, {
				listing: [ '/' ],
				setHeaders(res){
					// acorn encoding
					res.set('content-type', res.headers.get('content-type') + ';charset=UTF-8');
				},
			}));
			
			this.config.server.all(this.config.prefix + '*', async (req, res) => {
				var url = this.valid_url(this.unurl(req.url.href, this.empty_meta));
				
				if(!url)return;
				
				var meta = { url: url, origin: req.url.origin, base: url.href, id: req.meta_id },
					failure,
					timeout = setTimeout(() => !res.body_sent && (failure = true, res.error(500, 'Timeout')), this.config.timeout);
				
				if(!url || !this.protocols.includes(url.protocol))return res.redirect('/');
				
				var ip = await dns.promises.lookup(url.hostname).catch(err => (failure = true, res.error(400, err)));
				
				if(failure)return;
				
				if(ip.address.match(this.regex.url.ip))return res.error(403, 'Forbidden IP');
				
				(url.protocol == 'http:' ? http : https).request({
					agent: url.protocol == 'http:' ? this.config.http_agent : this.config.https_agent,
					servername: url.hostname,
					hostname: ip.address,
					path: url.fullpath,
					port: url.port,
					protocol: url.protocol,
					localAddress: this.config.interface,
					headers: await this.headers_encode(req.headers, meta),
					method: req.method,
				}, async resp => {
					var dest = req.headers['sec-fetch-dest'],
						decoded = this.decode_params(req.url),
						content_type = (resp.headers['content-type'] || '').split(';')[0],
						route = decoded.get('route'),
						dec_headers = await this.headers_decode(resp.headers, meta);
					
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
							
							return res.error(err);
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
		}
		
		if(this.config.ws){
			var wss = new WebSocket.Server({ server: this.config.server.server });
			
			wss.on('connection', async (cli, req) => {
				var req_url = new this.URL(req.url, new this.URL('wss://' + req.headers.host)),
					url = this.unurl(req_url.href, this.empty_meta),
					cookies = cookies.parse_object(req.headers.cookie),
					meta = { url: url, origin: req_url.origin, base: url, id: cookies.proxy_id };
				
				if(!url)return cli.close();
				
				var headers = await this.headers_encode(new nodehttp.headers(req.headers), meta),
					srv = new WebSocket(url, cli.protocol, {
						headers: headers,
						agent: ['wss:', 'https:'].includes(url.protocol) ? this.config.https_agent : this.config.http_agent,
					}),
					time = 8000,
					queue = [];
				
				srv.on('error', err => console.error(headers, url.href, util.format(err)) + cli.close());
				
				cli.on('message', data => srv.readyState == WebSocket.OPEN && srv.send(data));
				
				cli.on('close', code => (srv.readyState == WebSocket.OPEN && srv.close()));
				
				srv.on('open', () => {
					cli.send('open');
					
					srv.on('message', data => cli.send(data));
				});
				
				srv.on('close', code => cli.close());
			});
		}
	}
	async headers_encode(headers, meta){
		// prepare headers to be sent to a request url (eg google.com)
		
		// meta.id is hex, has no quotes so it can be wrapped in ""
		var out = {},
			existing = []; // meta.id && await data.all(`select * from "${meta.id}" where domain = ?1 or ?1 like ('%' || domain)`, [ meta.url.host ]).catch(err => []);
		
		out.cookie = existing.map(data => data.value).join(' ');
		
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
	async headers_decode(value, meta){
		var out = {};
		
		for(var header in value){
			var val = typeof value[header] == 'object' ? value[header].join(', ') : value[header],
				arr = Array.isArray(value[header]) ? value[header] : [ value[header] ];
			
			switch(header.toLowerCase()){
				case'set-cookie':
					
					var domains = await data.all(`select * from "${meta.id}"`).catch(err => (data.run(`create table if not exists "${meta.id}" (
						domain text primary key not null,
						value text,
						access integer not null
					)`), []));
					
					for(var ind in arr){
						var parsed = cookies.parse_object(val, true);
						
						for(var name in parsed){
							var cookie = parsed[name],
								domain = cookie.domain || meta.url.host,
								got = domains.find(data => data.domain == domain) || { domain: domain, value: '' };
							
							data.run(`insert or replace into "${meta.id}" (domain,value,access) values (?, ?, ?)`, got.domain, cookies.format_object(Object.assign(cookies.parse_object(got.value, true), { [name]: cookie })), Date.now());
						};
					};
					
					break;
				case'location':
					
					out[header] = this.url(val, meta, { route: 'html' });
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = val;
					
					break;
			}
		};
		
		out['referrer-policy'] = 'unsafe-url'; // soooo sus!!!
		
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
	bytes(){
		return new Promise((resolve, reject) => crypto.randomBytes(32, (err, buf) => err ? reject(err) : resolve(buf.toString('hex'))));
	}
}