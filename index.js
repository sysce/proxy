/*server*/
var fs = require('fs'),
	dns = require('dns'),
	zlib = require('zlib'),
	util = require('util'),
	path = require('path'),
	http = require('http'),
	https = require('https'),
	nodehttp = require('sys-nodehttp'),
	WebSocket = require('./lib/ws'),
	terser = require('./lib/terser'),
	jsdom = require('./lib/jsdom').JSDOM,
	bundler = class {
		constructor(modules, wrapper = [ '', '' ]){
			this.modules = modules;
			this.path = globalThis.fetch ? null : require('path');
			this.wrapper = wrapper;
		}
		wrap(str){
			return JSON.stringify([ str ]).slice(1, -1);
		}
		resolve_contents(path){
			return new Promise((resolve, reject) => globalThis.fetch ? fetch(path).then(res => res.text()).then(resolve).catch(reject) : fs.promises.readFile(path, 'utf8').then(resolve).catch(reject));
		}
		relative_path(path){
			return this.path ? this.path.relative(__dirname, path) : path;
		}
		run(){
			return new Promise((resolve, reject) => Promise.all(this.modules.map(data => new Promise((resolve, reject) => this.resolve_contents(data).then(text => resolve(this.wrap(new URL(this.relative_path(data), 'http:a').pathname) + '(module,exports,require,global){' + (data.endsWith('.json') ? 'module.exports=' + JSON.stringify(JSON.parse(text)) : text) + '}')).catch(err => reject('Cannot locate module ' + data + '\n' + err))))).then(mods => resolve(this.wrapper[0] + 'var require=((l,i,h)=>(h="http:a",i=e=>(n,f=l[typeof URL=="undefined"?n.replace(/\\.\\//,"/"):new URL(n,e).pathname],u={browser:!0})=>{if(!f)throw new TypeError("Cannot find module \'"+n+"\'");f.call(u.exports={},u,u.exports,i(h+f.name),new(_=>_).constructor("return this")());return u.exports},i(h)))({' + mods.join(',') + '});' + this.wrapper[1] )).catch(reject));
		}
	};
/*end_server*/

var URL = require('./lib/url.js'),
	syntax = require('./lib/syntax.js');

/**
* Rewriter
* @param {Object} config
* @param {Object} server - nodehttp server to run the proxy on, only on the serverside this is required
* @param {Boolean} [config.ws] - Determines if websocket support should be added
* @param {Object} [config.codec] - The codec to be used (rewriter.codec.plain, base64, xor)
* @param {Boolean} [config.prefix] - The prefix to run the proxy on
* @param {Boolean} [config.interface] - The network interface to request from
* @param {Boolean} [config.timeout] - The maximum request timeout time
* @param {Boolean} [config.title] - The title of the pages visited
* @param {Object} [config.http_agent] - Agent to be used for http: / ws: requests
* @param {Object} [config.https_agent] - Agent to be used for https: / wss: requests
* @property {Object} mime - Contains mime data for categorizing mimes
* @property {Object} attr - Contains attribute data for categorizing attributes and tags
* @property {Object} attr_ent - Object.entries called on attr property
* @property {Object} regex - Contains regexes used throughout the rewriter
* @property {Object} config - Where the config argument is stored
* @property {Object} URL - class extending URL with the `fullpath` property
*/

module.exports = class {
	static codec = {
		plain: {
			encode(str){
				return str;
			},
			decode(str){
				return str;
			},
		},
		xor: {
			name: 'xor',
			encode(str){
				if(!str || typeof str != 'string')return str;
				
				return str.split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt() ^ 2) : char).join('');
			},
			decode(str){
				// same process
				return this.encode(str);
			}
		},
		base64: {
			name: 'base64',
			encode(str){
				if(!str || typeof str != 'string')return str;
				
				var b64chs = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='),
					u32, c0, c1, c2, asc = '',
					pad = str.length % 3;
				
				for(var i = 0; i < str.length;) {
					if((c0 = str.charCodeAt(i++)) > 255 || (c1 = str.charCodeAt(i++)) > 255 || (c2 = str.charCodeAt(i++)) > 255)throw new TypeError('invalid character found');
					u32 = (c0 << 16) | (c1 << 8) | c2;
					asc += b64chs[u32 >> 18 & 63]
						+ b64chs[u32 >> 12 & 63]
						+ b64chs[u32 >> 6 & 63]
						+ b64chs[u32 & 63];
				}
				
				return pad ? asc.slice(0, pad - 3) + '==='.substr(pad) : asc;
			},
			decode(str){
				if(!str || typeof str != 'string')return str;
				
				var b64tab = {"0":52,"1":53,"2":54,"3":55,"4":56,"5":57,"6":58,"7":59,"8":60,"9":61,"A":0,"B":1,"C":2,"D":3,"E":4,"F":5,"G":6,"H":7,"I":8,"J":9,"K":10,"L":11,"M":12,"N":13,"O":14,"P":15,"Q":16,"R":17,"S":18,"T":19,"U":20,"V":21,"W":22,"X":23,"Y":24,"Z":25,"a":26,"b":27,"c":28,"d":29,"e":30,"f":31,"g":32,"h":33,"i":34,"j":35,"k":36,"l":37,"m":38,"n":39,"o":40,"p":41,"q":42,"r":43,"s":44,"t":45,"u":46,"v":47,"w":48,"x":49,"y":50,"z":51,"+":62,"/":63,"=":64};
				
				str = str.replace(/\s+/g, '');
				
				//if(!b64re.test(str))throw new TypeError('malformed base64.');
				
				str += '=='.slice(2 - (str.length & 3));
				var u24, bin = '', r1, r2;
				
				for (var i = 0; i < str.length;) {
					u24 = b64tab[str.charAt(i++)] << 18
					| b64tab[str.charAt(i++)] << 12
					| (r1 = b64tab[str.charAt(i++)]) << 6
					| (r2 = b64tab[str.charAt(i++)]);
					bin += r1 === 64 ? String.fromCharCode(u24 >> 16 & 255)
						: r2 === 64 ? String.fromCharCode(u24 >> 16 & 255, u24 >> 8 & 255)
							: String.fromCharCode(u24 >> 16 & 255, u24 >> 8 & 255, u24 & 255);
				}
				
				return bin;
			},
		},
	}
	constructor(config){
		this.config = Object.assign({
			http_agent: null,
			https_agent: module.browser ? null : new https.Agent({ rejectUnauthorized: false }),
			codec: this.constructor.codec.plain,
			interface: null,
			prefix: '/',
			ws: true, // websocket proxying
			timeout: 30000, // max request timeout
			title: 'Service',
		}, config);
		
		this.URL = class extends URL {
			get fullpath(){
				var path = this.href.substr(this.origin.length),
					hash = path.indexOf('#');
				
				if(hash != -1)path = path.slice(0, hash);
				
				return path;
			}
		};
		
		if(typeof this.config.codec == 'string')this.config.codec = this.constructor.codec[this.config.codec];
		
		this.empty_meta = { base: 'null', origin: 'null' };
		
		/*server*/if(this.config.server){
			if(this.config.dns)dns.setServers(this.config.dns);
			
			this.config.server.use(this.config.prefix + '*', (req, res) => {
				if(req.url.searchParams.has('html'))return res.contentType('application/javascript').send(this.preload[0] || '');
				if(req.url.searchParams.has('favicon'))return res.contentType('image/png').send(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAA', 'base64'));
				
				var url = this.valid_url(this.unurl(req.url.href, this.empty_meta)),
					meta = { url: url, origin: req.url.origin, base: url.origin },
					failure = false,
					timeout = setTimeout(() => !res.resp.sent_body && (failure = true, res.cgi_status(500, 'Timeout')), this.config.timeout);
				
				if(!url || !this.http_protocols.includes(url.protocol))return res.redirect('/');
				
				dns.lookup(url.hostname, (err, ip) => {
					if(err)return res.cgi_status(400, err);
					
					if(ip.match(this.regex.url.ip))return res.cgi_status(403, 'Forbidden IP');
					
					try{
						(url.protocol == 'http:' ? http : https).request({
							agent: url.protocol == 'http:' ? this.config.http_agent : this.config.https_agent,
							servername: url.hostname,
							hostname: ip,
							path: url.fullpath,
							port: url.port,
							protocol: url.protocol,
							localAddress: this.config.interface,
							headers: this.headers_encode(req.headers, meta),
							method: req.method,
						}, resp => {
							var dest = req.headers['sec-fetch-dest'],
								decoded = this.decode_params(req.url),
								content_type = (resp.headers['content-type'] || '').split(';')[0],
								type =  content_type == 'text/plain' ? 'plain' : dest == 'font' ? 'font' : decoded.has('type') ? decoded.get('type') : dest == 'script' ? 'js' : (this.mime_ent.find(([ key, val ]) => val.includes(content_type)) || [])[0],
								dec_headers = this.headers_decode(resp.headers, meta);
							
							res.status(resp.statusCode.toString().startsWith('50') ? 400 : resp.statusCode);
							
							for(var name in dec_headers)res.set(name, dec_headers[name]);
							
							clearTimeout(timeout);
							
							if(failure)return;
							
							if(decoded.get('route') != 'false' && ['js', 'css', 'html', 'manifest'].includes(type))this.decompress(req, resp, async body => {
								if(!body.byteLength)return res.send(body);
								
								if(this[type + '_async'])type += '_async';
								
								console.time(type, Buffer.byteLength(body));
								
								body = body.toString();
								var parsed = this[type](body, meta, { global: decoded.get('global') == true, mime: content_type });
								console.timeEnd(type, Buffer.byteLength(body));
								
								if(parsed instanceof Promise)parsed = await parsed.catch(err => util.format(err));
								
								res.send(parsed);
							});
							else{
								var encoding = resp.headers['content-encoding'] || resp.headers['x-content-encoding'];
								
								if(encoding)res.set('content-encoding', encoding);
								
								res.pipe_from(resp);
							}
						}).on('error', err => {
							clearTimeout(timeout);
							
							if(failure || res.resp.sent_body)return;
							
							res.cgi_status(400, err);
						}).end(req.raw_body);
					}catch(err){
						clearTimeout(timeout);
						
						if(failure || res.resp.sent_body)return;
						
						console.error('runtime error:', err);
						
						res.cgi_status(400, err);
					}
				});
			});
			
			if(this.config.ws){
				var wss = new WebSocket.Server({ server: this.config.server.server });
				
				wss.on('connection', (cli, req) => {
					var req_url = new this.URL(req.url, new this.URL('wss://' + req.headers.host)),
						url = this.valid_url(this.unurl(req_url, this.empty_meta));
					
					if(!url)return cli.close();
					
					var headers = this.headers_encode(new nodehttp.headers(req.headers), { url: url, origin: req_url, base: url }),
						srv = new WebSocket(url, {
							headers: headers,
							agent: ['wss:', 'https:'].includes(url.protocol) ? this.config.https_agent : this.config.http_agent,
						}),
						time = 8000,
						timeout = setTimeout(() => srv.close(), time),
						interval = setInterval(() => cli.send('srv-alive'), time / 2),
						queue = [];
					
					srv.on('error', err => console.error(headers, url.href, util.format(err)) + cli.close());
					
					cli.on('message', data => {
						clearTimeout(timeout);
						
						timeout = setTimeout(() => srv.close(), time);
						
						if(data != 'srv-alive' && srv.readyState == WebSocket.OPEN)srv.send(data);
					});
					
					cli.on('close', code => (srv.readyState == WebSocket.OPEN && srv.close(), clearTimeout(timeout) + clearInterval(interval)));
					
					srv.on('open', () => {
						cli.send('srv-open');
						
						srv.on('message', data => cli.send(data));
					});
					
					srv.on('close', code => cli.close());
				});
			}
		}
		/*end_server*/
		
		this.dom = module.browser ? global : new jsdom();
		
		if(this.dom.window && this.dom.window.DOMParser)this.html_parser = new this.dom.window.DOMParser();
		
		this.regex = {
			prw_ind: /\/\*(pmrw\d+)\*\/[\s\S]*?\/\*\1\*\//g,
			css: {
				url: /(?!(["'`])[^"'`]*?\1)(?<![^\s:])url\(((?:[^"'`]|(["'`])[^"'`]*?\3)*?)\)/g,
				import: /(@import\s*?(\(|"|'))([\s\S]*?)(\2|\))/gi,
				property: /(\[)(\w+)(\*?=.*?]|])/g,
			},
			html: {
				srcset: /(\S+)(\s+\d\S)/g,
				newline: /\n/g,
				attribute: /([a-z_-]+)(?:$|\s*?=\s*?(true|false|(["'`])((\\["'`]|[^"'`])*?)\3))/gi,
			},
			url: {
				proto: /^([^\/]+:)/,
				host: /(:\/+)_(.*?)_/,
				ip: /^192\.168\.|^172\.16\.|^10\.0\.|^127\.0/,
				whitespace: /\s+/g,
			},
			server_only: /\/\*server\*\/[\s\S]*?\/\*end_server\*\//g,
			skip_header: /(?:^sec-websocket-key|^cdn-loop|^cf-(request|connect|ip|visitor|ray)|^real|^forwarded-|^x-(real|forwarded|frame)|^strict-transport|content-(security|encoding|length)|transfer-encoding|access-control|sourcemap|trailer)/i,
			sourcemap: /#\s*?sourceMappingURL/gi,
		};
		
		this.krunker_load = decodeURIComponent(`color%3Argba(255%2C255%2C255%2C0.4)'%3EMake%20sure%20you%20are%20using%20the%20latest%20version`);
		
		this.mime = {
			js: [ 'module', 'text/javascript', 'text/emcascript', 'text/x-javascript', 'text/x-emcascript', 'application/javascript', 'application/x-javascript', 'application/emcascript', 'application/x-emcascript' ],
			css: [ 'text/css' ],
			xsl: [ 'text/xsl' ],
			html: [ 'text/html', 'text/xml', 'application/xml', 'application/xhtml+xml', 'application/xhtml+xml' ],
			// xml: [ 'text/xml', 'application/xml', 'application/xhtml+xml', 'application/xhtml+xml' ],
		};
		
		this.mime_ent = Object.entries(this.mime);
		
		this.attr = {
			html: [ [ 'iframe' ], [ 'srcdoc' ] ],
			css: [ '*', [ 'style' ] ],
			css_keys: [ 'background', 'background-image', 'src' ],
			url: [ [ 'track', 'template', 'source', 'script', 'object', 'media', 'link', 'input', 'image', 'video', 'iframe', 'frame', 'form', 'embed', 'base', 'area', 'anchor', 'a', 'img', 'use' ], [ 'srcset', 'href', 'xlink:href', 'src', 'action', 'content', 'data', 'poster' ] ],
			// js attrs begin with on
			del: [ '*', ['nonce', 'integrity'] ],
		};
		
		this.attr_ent = Object.entries(this.attr);
		
		this.protocols = [ 'http:', 'https:', 'ws:', 'wss:' ];
		
		this.http_protocols = [ 'http:', 'https:' ];
		
		/*server*/if(!module.browser){
			var libs = [
					path.join(__dirname, 'lib', 'url.js'),
					path.join(__dirname, 'lib', 'syntax.js'),
				],
				mods = new bundler([
					path.join(__dirname, 'html.js'),
					...libs,
					__filename,
				]),
				compact = new bundler([ ...libs, __filename ]);
			
			this.preload = ['', 0];
			
			this.bundle = async () => {
				var times = await Promise.all(mods.modules.map(data => new Promise(resolve => fs.promises.stat(data).then(data => resolve(data.mtimeMs))))).then(data => data.join(''));
				
				if(this.preload[1] == times)return;
				
				compact.run().then(code => terser.minify(code.replace(this.regex.server_only, ''), { mangle: { reserved: ['require', 'compact'] } })).then(data => this.compact = data.code).catch(console.error);
				
				var _compact = await mods.run().then(code => code.replace(this.regex.server_only, '')),
					merged = `document.currentScript&&document.currentScript.remove();window.$rw_init=rewrite_conf=>{var compact=()=>{${_compact};return require};compact()("./html.js")};window.$rw_init(${this.str_conf()})`;
				
				this.preload = [ await terser.minify(merged, {
					compress: { toplevel: true },
					mangle: { reserved: ['require', 'compact'] }
				}).then(data => data.code + '\n//# sourceURL=RW-HTML').catch(console.error), times ];
			};
			
			this.bundle();
			setInterval(this.bundle, 2000);
		}else/*end_server*/{
			this.compact = compact.toString();
			if(this.compact.endsWith(';return require}'))this.compact = this.compact.slice('()=>{'.length, -(';return require}'.length));
			
			if(this.compact.startsWith('()=>{'))this.compact = 'var require=(' + this.compact + ')();';
		}
	}
	validate_meta(meta){
		var check = {
			origin: 'string',
			base: 'string',
		};
		
		if(typeof meta != 'object')throw new TypeError('"constructor" is not type "object" (recieved ' + JSON.stringify(typeof meta) + ')');
		
		// origin is EXACTLY an origin ( protocol + slashes? + host + port? )
		// base is EXACTLY an origin of an un-proxied URL
		
		for(var prop in check)if(typeof meta[prop] != check[prop])throw new TypeError(JSON.stringify(prop) + ' is not of type ' + JSON.stringify(check[prop]) + ' (recieved ' + JSON.stringify(typeof meta[prop]) + ')');
		
		return true;
	}
	url(value, meta, options = {}){
		if(options.ws && !this.config.ws)throw new TypeError('WebSockets are disabled');
		
		var oval = value;
		
		this.validate_meta(meta);
		
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		if(value.startsWith('blob:') && options.type == 'js' && module.browser){
			var raw = global.$rw.urls.get(value);
			
			// capture blob being used for js
			if(raw)return (global.$rw.origina.get(global.URL.createObjectURL) || global.URL.createObjectURL)(new Blob([ this.js(raw, meta, { type: 'js' }) ]));
		}
		
		if(value.match(this.regex.url.proto) && !this.protocols.some(proto => value.startsWith(proto)))return value;
		
		var url = this.valid_url(value, meta.base);
		
		if(!url)return value;
		
		var out = url.href,
			valid = this.valid_url(value),
			query = new this.URL.searchParams(),
			decoded = this.decode_params(url);
		
		// check if url was already parsed
		if(decoded.has('url') && valid && valid.origin == meta.origin){
			console.error('why reprocess ' + JSON.stringify(value) + ', has there been a proxy leak?');
			return value;
		}
		
		// relative paths or absolute
		if(url.origin == meta.origin)out = meta.base + url.fullpath;
		
		query.set('url', encodeURIComponent(this.config.codec.encode(out, meta)));
		
		if(meta.keep_input)query.set('raw', this.config.codec.encode(value));
		
		if(options.global != null)query.set('global', options.global);
		// can be false to indicate url is to not be proxied
		if(options.route != null)query.set('route', options.route);
		
		// referer
		query.set('ref', this.config.codec.encode(meta.base, meta));
		
		var out = (options.ws ? meta.origin.replace(this.regex.url.proto, 'ws' + (meta.origin.startsWith('https:') ? 's' : '') + '://') : meta.origin) + this.config.prefix + query;
		
		if(module.browser && oval instanceof global.Request)out = new global.Request(out, oval);
		
		return out;
	}
	unurl(value, meta, options = {}){;
		this.validate_meta(meta);
		
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		var decoded = this.decode_params(value);
		
		if(!decoded.has('url'))return value;
		
		if(decoded.has('raw') && options.keep_input)return this.config.codec.decode(decoded.get('raw'), meta);
		
		var out = this.config.codec.decode(decoded.get('url'), options),
			search_ind = out.indexOf('?');
		
		if(decoded.osearch)out = out.substr(0, search_ind == -1 ? out.length : search_ind) + decoded.osearch;
		
		return out;
	}
	js(value, meta, options = {}){
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		this.validate_meta(meta);
		
		if(value.includes(this.krunker_load))value = `fetch('https://api.sys32.dev/latest.js').then(r=>r.text()).then(s=>new Function(s)())`;
		
		value = value.replace(this.regex.sourcemap, '# undefined');
		
		var id = this.checksum(value),
			tree = syntax.parse(value, {
				allowImportExportEverywhere: true,
				ecmaVersion: 2020,
			});
		
		syntax.walk(tree, node => {
			if(node.type == 'ThisExpression')Object.assign(node, {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: 'rw_this' },
				arguments: [ { type: 'ThisExpression' } ],
			});
			else if(options.rewrite_eval != false && node.type == 'CallExpression' && node.callee && node.callee.name == 'eval')node.arguments = [{
				type: 'CallExpression',
				callee: { type: 'Identifier', name: 'rw_eval' },
				arguments: node.arguments,
			}];
			else if(node.type == 'ImportExpression')node.source = {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: 'rw_url' },
				arguments: [ node.source, { type: 'Identifier', name: '$rw' } ],
			};
		});
		
		var imports = [],
			exports = [],
			lets = [];
		
		tree.body.forEach((node, ind) => {
			// first level body
			if(node.type == 'ImportDeclaration'){
				imports.push(node);
				node.delete = true;
			}else if(node.type == 'ExportNamedDeclaration'){
				// much more work needed on exports
				// pull out expressions specifically
				// CallExpression
				// VariableDeclarator ?
				// export let variable = x;
				
				var exps = [],
					wind = 0;
				
				// nested walking might not be best on cpu
				syntax.walk(node, snode => {
					wind++;
					
					if(snode.type == 'ExpressionStatement'){
						var id = 'EXPORT_STATE_' + wind;
						
						exps.push([ snode.expression, id ]);
						
						Object.assign(snode, {
							type: 'ExpressionStatement',
							expression: { type: 'Identifier', name: id },
						});
					}else if(snode.type == 'ExportNamedDeclaration'){
						snode.specifiers.forEach((specifier, ind) => {
							var id = 'EXPORT_NAME_' + ind;
							
							exps.push([ specifier.local, id ]);
							
							specifier.local = { type: 'Identifier', name: id };
						});
					}
				});
				
				exports.push(node);
				
				// replace in array
				tree.body.splice(ind, 1, {
					type: 'VariableDeclaration',
					declarations: exps.map(([ exp, id ]) => ({
						type: 'VariableDeclarator',
						id: { type: 'Identifier', name: id },
						init: exp,
					})),
					kind: 'var',
				});
			}else if(node.type == 'VariableDeclaration' && node.kind == 'let')node.kind = '', syntax.walk(node, snode => {
				if(snode.type == 'VariableDeclarator'){
					if(snode.id.type == 'ObjectPattern')snode.id.properties.forEach(prop => lets.push(prop.key.name));
					else lets.push(snode.id.name);
				}
			});
		});
		
		tree.body = [ lets.length ? {
			type: 'VariableDeclaration',
			kind: 'let',
			declarations: lets.map(name => ({
				type: 'VariableDeclarator',
				init: null,
				id: {
					type: 'Identifier',
					name: name,
				},
			})),
		} : null ].concat({
			type: 'Identifier',
			// (meta.url ? '//# sourceURL=' + data.url.href.substr(data.url.href.indexOf(data.url.host)) + '\n' : '') +
			name: '/*pmrw' + id + '*/let fills=' + (options.global == true ? '$rw.fills' : `new((compact=>(compact=()=>{${this.compact};return require},compact()('./index.js')))())(${this.str_conf()}).globals(${this.wrap(meta.url)}),rw_eval=fills.rw_eval`) + ['window', 'Window', 'location', 'parent', 'top', 'self', 'globalThis', 'document', 'importScripts', 'frames'].map(key => ',' + key + '=fills.this.' + key).join('') + ';\n' + (options.append_fills || '') +'/*pmrw' + id + '*/',
		}, tree.body).filter(val => val && !val.delete);
		
		// rewrite imports
		imports.forEach(imp => imp.source.value = this.url(imp.source.value, meta));
		
		// add in imports and exports then scope entire function
		tree.body = [
			...imports,
			{
				type: 'BlockStatement',
				body: tree.body,
			},
			...exports,
		];
		
		return syntax.string(tree, { format: { compact: true } });
	}
	xsl(value, data = {}){
		if(!value)return value;
		
		value += '';
		
		console.log(value);
		
		return value;
	}
	/**
	* Rewrites CSS urls and selectors
	* @param {String} value - CSS code
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @returns {String}
	*/
	css(value, data = {}){
		if(!value)return value;
		
		value += '';
		
		[
			[this.regex.css.url, (match, a, field) => {
				var wrap = '';
				
				if(['\'', '"', '`'].includes(field[0]))wrap = field[0], field = field.slice(1, -1);
				
				if(!wrap)wrap = '"';
				
				field = wrap + this.url(field, data) + wrap;
				
				return 'url(' + field + ')';
			} ],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, data) + quote ],
		].forEach(([ reg, val ]) => value = value.replace(reg, val));
		
		return value;
	}
	uncss(value, meta, options = {}){
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		this.validate_meta(meta);
		
		[
			[this.regex.css.url, (match, a, field) => {
				var wrap = '';
				
				if(['\'', '"', '`'].includes(field[0]))wrap = field[0], field = field.slice(1, -1);
				
				if(!wrap)wrap = '"';
				
				field = wrap + this.unurl(field, meta) + wrap;
				
				return 'url(' + field + ')';
			} ],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, data) + quote ],
		].forEach(([ reg, val ]) => value = value.replace(reg, val));
		
		return value;
	}
	unjs(value, meta, options = {}){
		if(!value)return value;
		
		var slice_last = false; // removing final part of scope
		
		value = value.replace(/{\/\*(pmrw\d+)\*\/[\s\S]*?\/\*\1\*\//g, () => {
			slice_last = true;
			
			return '';
		}).replace(/rw_this\(this\)/g, 'this').replace(/rw_eval\((.*?)\)/g, '$1');
		// eval regex might be a bit off, fix by checking for nested parenthesis
		return slice_last ? value.slice(-1) : value;
	}
	manifest(value, meta, options = {}){
		var json;
		
		try{ json = JSON.parse(value) }catch(err){ return value };
		
		return JSON.stringify(json, (key, val) => ['start_url', 'key', 'src', 'url'].includes(key) ? this.url(val, meta) : val);
	}
	/*server*/
	tick(){
		return new Promise(resolve => process.nextTick(resolve));
	}
	async html_async(value, meta, options = {}){
		if(!value)return value;
		
		value = value.toString();
		
		options.mime = options.mime || 'text/html';
		
		try{
			var document = this.html_parser.parseFromString(module.browser ? '<div id="pro-root">' + value + '</div>' : value, options.mime),
			charset = '<meta charset="ISO-8859-1">';
		}catch(err){
			console.error(err);
			
			return 'got:\n' + err.message;
		}
		
		if(options.mime.includes('xml'))try{
			// PROCESSING_INSTRUCTION_NODE = 7
			var walker = this.dom.window.document.createTreeWalker(document, this.dom.window.NodeFilter.SHOW_PROCESSING_INSTRUCTION),
				node;
			
			while(node = walker.nextNode()){
				if(node.target == 'xml-stylesheet'){
					var attrs = {};
					
					node.data.replace(this.regex.html.attribute, (match, name, value, x, string) => attrs[name] = string || value);
					
					if(this.mime.xsl.includes(attrs.type))attrs.href = this.url(attrs.href, meta);
					
					node.data = Object.entries(attrs).map(([ name, value ]) => name + (value ? '=' + JSON.stringify(value) : '')).join(' ');
				}
				
				await this.tick();
			}
		}catch(err){
			console.error(err);
		}
		
		var nodes = document.querySelectorAll(module.browser ? '#pro-root *' : '*');
		
		for(var ind in nodes){
			var node = nodes[ind];
			
			if(!(node instanceof this.dom.window.Node))continue;
			
			switch((node.tagName || '').toLowerCase()){
				case'meta':
					
					if(node.outerHTML.toLowerCase().includes('charset'))charset = node.outerHTML;
					
					if(node.getAttribute('http-equiv') && node.getAttribute('content'))node.setAttribute('content', node.getAttribute('content').replace(/url=(.*?$)/, (m, url) => 'url=' + this.url(url, meta)));
					
					// node.remove();
					
					break;
				case'title':
					
					node.remove();
					
					break;
				case'link':
					
					if(node.rel && node.rel.includes('icon'))node.remove();
					// else if(node.rel == 'manifest')node.href = this.url(node.href, { origin: data.url, base: data.base, type: 'manifest' });
					
					break;
				case'script':
					
					var type = node.getAttribute('type') || this.mime.js[0];
					
					// 3rd true indicates this is a global script
					if(node.textContent)node.textContent = this.js(node.textContent, meta, { global: true });
					
					break;
				case'style':
					
					node.textContent = this.css(node.textContent, meta);
					
					break;
				case'base':
					
					try{
						if(node.href)meta.base = new this.URL(node.href, meta.url).href;
					}catch(err){
						console.error(err);
					}
					
					node.remove();
					
					break;
			}
			
			var attrs = node.getAttributeNames();
			
			for(var attr_ind in attrs){
				this.html_attr(node, attrs[attr_ind], meta, options);
				
				await this.tick();
			}
			
			await this.tick();
		}
		
		if(!options.snippet && document.head)document.head.insertAdjacentHTML('afterbegin', `${charset}${decodeURI('%3C')}title>${this.config.title}${decodeURI('%3C')}/title>${decodeURI('%3C')}link type='image/x-icon' rel='shortcut icon' href='.${this.config.prefix}?favicon'>${decodeURI('%3C')}script src='${this.config.prefix}?html=${this.preload[1]}'>${decodeURI('%3C')}/script>`, 'proxied');
		
		return this.html_serial(document);
	}
	/*end_server*/
	html(value, meta, options){
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		this.validate_meta(meta);
		
		options.mime = options.mime || 'text/html';
		
		try{
			var document = this.html_parser.parseFromString(module.browser ? '<div id="pro-root">' + value + '</div>' : value, options.mime),
			charset = '<meta charset="ISO-8859-1">';
		}catch(err){
			console.error(err);
			
			return 'got:\n' + err.message;
		}
		
		if(options.mime.includes('xml'))try{
			var walker = this.dom.window.document.createTreeWalker(document, this.dom.window.NodeFilter.SHOW_PROCESSING_INSTRUCTION),
				node;
		
			while(node = walker.nextNode()){
				if(node.target == 'xml-stylesheet'){
					var attrs = {};
					
					node.data.replace(this.regex.html.attribute, (match, name, value, x, string) => {
						attrs[name] = string || value;
					});
					
					if(this.mime.xsl.includes(attrs.type))attrs.href = this.url(attrs.href, meta);
					
					node.data = Object.entries(attrs).map(([ name, value ]) => name + (value ? '=' + JSON.stringify(value) : '')).join(' ');
				}
			}
		}catch(err){
			console.error(err);
		}
		
		document.querySelectorAll(module.browser ? '#pro-root *' : '*').forEach(node => {
			switch((node.tagName || '').toLowerCase()){
				case'meta':
					
					if(node.outerHTML.toLowerCase().includes('charset'))charset = node.outerHTML;
					
					if(node.getAttribute('http-equiv') && node.getAttribute('content'))node.setAttribute('content', node.getAttribute('content').replace(/url=(.*?$)/, (m, url) => 'url=' + this.url(url, meta)));
					
					// node.remove();
					
					break;
				case'title':
					
					node.remove();
					
					break;
				case'link':
					
					if(node.rel && node.rel.includes('icon'))node.remove();
					// else if(node.rel == 'manifest')node.href = this.url(node.href, { origin: data.url, base: data.base, type: 'manifest' });
					
					break;
				case'script':
					var type = node.getAttribute('type') || this.mime.js[0];
					
					// 3rd true indicates this is a global script
					if(this.mime.js.includes(type) && node.innerHTML)node.textContent = this.js(node.textContent, meta, { global: true });
					
					break;
				case'style':
					
					node.innerHTML = this.css(node.innerHTML, meta);
					
					break;
				case'base':
					
					try{
						if(node.href)meta.base = new this.URL(node.href, data.url).href;
					}catch(err){
						console.error(err);
					}
					
					node.remove();
					
					break;
			}
			
			node.getAttributeNames().forEach(name => this.html_attr(node, name, meta, options));
		});
		
		if(!data.snippet && document.head)document.head.insertAdjacentHTML('afterbegin', `${charset}${decodeURI('%3C')}title>${this.config.title}${decodeURI('%3C')}/title>${decodeURI('%3C')}link type='image/x-icon' rel='shortcut icon' href='.${this.config.prefix}?favicon'>${decodeURI('%3C')}script src='${this.config.prefix}?html=${this.preload[1]}'>${decodeURI('%3C')}/script>`, 'proxied');
		
		return this.html_serial(document);
	}
	/**
	* Validates and parses attributes, needs data since multiple handlers are called
	* @param {Node|Object} node - Object containing at least getAttribute and setAttribute
	* @param {String} name - Name of the attribute
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	*/
	html_attr(node, name, meta, options){
		if(name.startsWith('data-'))return;
		
		var ovalue, value = node.getAttribute(name);
		
		ovalue = value;
		
		if(!value)return;
		
		value = (value + '').replace(this.regex.newline, '');
		
		var	tag = (node.tagName || '').toLowerCase(),
			attr_type = this.attr_type(name, tag);
		
		// if(attr_type == 'url')node.setAttribute('data-rw' + name, value);
		
		switch(attr_type){
			case'url':
				value = name == 'srcset' ?
					value.replace(this.regex.html.srcset, (m, url, size) => this.url(url, meta) + size)
					: name == 'xlink:href' && value.startsWith('#')
						? value
						: this.url(value, meta, { global: tag == 'script', type: node.rel == 'manifest' ? 'manifest' : tag == 'script' ? 'js' : null });
				break;
			case'del':
				return node.removeAttribute(name);
				break;
			case'css':
				value = this.css(value, meta);
				break;
			case'js':
				value = 'prop_eval(' + this.wrap(this.constructor.codec.base64.encode(unescape(encodeURIComponent(value)))) + ')';
				break;
			case'html':
				value = this.html(value, meta, { snippet: true });
				break;
		}
		
		try{ node.setAttribute(name, value) }catch(err){ console.error(err); node[name] = value };
	}
	/**
	* Decoding blobs
	* @param {Blob}
	* @returns {String}
	*/
	decode_blob(data){ // blob => string
		var decoder = new TextDecoder();
		
		return data.map(chunk => {
			if(typeof chunk == 'string')return chunk;
			else return decoder.decode(chunk);
		}).join('');
	}
	/**
	* Determines the attribute type using the `attr_ent` property
	* @param {String} name - Property name
	* @param {String} [tag] - Element tag
	* @returns {String}
	*/
	attr_type(name, tag){
		return name.startsWith('on') ? 'js' : (this.attr_ent.find(x => (!tag || x[1][0] == '*' || x[1][0].includes(tag)) && x[1][1].includes(name))||[])[0];
	}
	/**
	* Prepares headers to be sent to the client from a server
	* @param {Object} - Headers
	* @returns {Object}
	*/
	headers_decode(value, data = {}){
		var out = {};
		
		for(var header in value){
			var val = typeof value[header] == 'object' ? value[header].join(', ') : value[header],
				arr = Array.isArray(value[header]) ? value[header] : [ value[header] ];
			
			switch(header.toLowerCase()){
				case'set-cookie':
					
					out[header] = [];
					
					arr.forEach(val => out[header].push(this.cookie_encode(val, { origin: data.origin, url: data.url, base: data.base })));
					
					break;
				/*case'websocket-origin':
					
					out[header] = this.config.codec.decode(this.valid_url(data.url).searchParams.get('origin'), data) || this.valid_url(data.url).origin;
					
					break;
				case'websocket-location':*/
				case'location':
					
					out[header] = this.url(val, { origin: data.origin, url: data.url, base: data.base });
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = val;
					
					break;
			}
		};
		
		// soon?
		// out['x-rwog'] = JSON.stringify(value);
		
		return out;
	}
	/**
	* Prepares headers to be sent to the server from a client, calls URL handler so data object is needed
	* @param {Object} - Headers
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @param {Object} [data.type] - The type of URL this is (eg js, css, html), helps the rewriter determine how to handle the response
	* @param {Object} [data.ws] - If the URL is a WebSocket
	* @returns {Object}
	*/
	/*server*/headers_encode(value, meta, options){
		// prepare headers to be sent to a request url (eg google.com)
		
		var out = {};
		
		value.forEach((value, header) => {
			// val = typeof value[header] == 'object' ? value[header].join('') : value[header];
			
			switch(header.toLowerCase()){
				/*case'referrer':
				case'referer':
					
					// FIX
					out[header] = meta.origin.searchParams.has('ref') ? this.config.codec.decode(meta.origin.searchParams.get('ref'), meta) : this.valid_url(meta.url).href;
					
					break;*/
				case'cookie':
					
					out[header] = this.cookie_decode(value, meta);
					
					break;
				case'host':
					
					out[header] = new this.URL(meta.url).host;
					
					break;
				case'sec-websocket-key': break;
				case'origin':
					
					/*
					FIX
					var url;

					url = this.valid_url(this.config.codec.decode(this.decode_params(data.origin).get('ref'), data));
					
					out.Origin = url ? url.origin : this.valid_url(data.url).origin;*/
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = value;
					
					break;
			}
		});
		
		out['accept-encoding'] = 'gzip, deflate'; // , br
		
		out.host = new this.URL(meta.url).host;
		
		return out;
	}/*end_server*/
	construct_cookies(cookies, data = {}){
		return cookies.filter(cookie => cookie && cookie.name && cookie.value).map(cookie => {
			var out = [];
			
			out.push(cookie.name + '=' + (cookie.value || ''));
			
			if(cookie.secure)out.push('Secure');
			
			if(cookie.http_only)out.push('HttpOnly');
			
			if(cookie.same_site)out.push('SameSite=' + cookie.same_site);
			
			return out.map(value => value + ';').join(' ');
		}).join(' ');
	}
	deconstruct_cookies(value, data = {}){
		var cookies = [];
		
		value.split(';').forEach(data => {
			if(data[0] == ' ')data = data.substr(1);
			
			var [ name, value ] = data.split('='),
				lower_name = name.toLowerCase();
			
			if(['domain', 'expires', 'path', 'httponly', 'samesite', 'secure', 'max-age'].includes(lower_name)){
				var cookie = cookies[cookies.length - 1];
				
				if(cookie)switch(lower_name){
					case'expires':
						
						cookie.expires = new Date(value);
						
						break;
					case'path':
						
						cookie.path = value;
						
						break;
					case'httponly':
						
						cookie.http_only = true;
						
						break;
					case'samesite':
						
						cookie.same_site = value ? value.toLowerCase() : 'none';
						
						break;
					case'secure':
						
						cookie.secure = true;
						
						break;
					case'priority':
						
						cookie.priority = value.toLowerCase();
						
						break;
					case'domain':
						
						cookie.domain = value;
						
						break;
				}
			}else{
				var cookie = { name: name, value: value };
				
				cookies.push(cookie);
			}
		});
		
		return cookies;
	}
	/**
	* Set-cookie processing
	* @param {String} value - Cookie header
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} data.url - Base URL (needed for hostname when adding suffix)
	* @returns {Object}
	*/
	cookie_encode(value, data = {}){
		return this.construct_cookies(this.deconstruct_cookies(value, data).map(cookie => (cookie.name += '@' + (cookie.domain || this.valid_url(data.url).hostname), cookie.domain = null, cookie)));
	}
	/**
	* Processes the cookie the client sends and prepares to be sent to a server
	* @param {String} value - Cookie header
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} data.url - Base URL (needed for hostname when adding suffix)
	* @returns {Object}
	*/
	cookie_decode(value, data = {}){
		return this.construct_cookies(this.deconstruct_cookies(value).map(cookie => {
			var target = cookie.name.split('@')[1],
				host = this.valid_url(data.url).hostname;
			
			if(!target || !host)return;
			
			if(target.startsWith('.') && host == target.substr(1) || host.endsWith(target)){
				cookie.name = cookie.name.split('@')[0];
				
				return cookie;
			}
		}));
		
		value.split(';').map(split => {
			var split = (split + '').trim().split('='),
				fn = split[0].split('@'),
				origin = fn.splice(-1).join('');
			
			return fn && this.valid_url(data.url).hostname.includes(origin) ? fn[0] + '=' + split[1] + ';' : null;
		}).filter(v => v).join(' ');
	}
	/**
	* Decode params of URL, takes the prefix and then decodes a querystring
	* @param {URL|String} URL to parse
	* @returns {URLSearchParams}
	*/
	decode_params(url){
		url = url + '';
		
		var start = url.indexOf(this.config.prefix) + this.config.prefix.length,
			search_ind = url.indexOf('?'),
			out;
		
		try{
			out = new this.URL.searchParams(decodeURIComponent(url.substr(start, search_ind == -1 ? url.length : search_ind)));
		}catch(err){
			// console.error(err);
			out = new this.URL.searchParams();
		}
		
		if(search_ind != -1)out.osearch = url.substr(search_ind);
		
		return out;
	}
	/**
	* Decompresses response data
	* @param {Object} Client request
	* @param {Object} Request response
	* @param {Function} Callback
	*/
	decompress(req, res, callback){
		var chunks = [];
		
		if(req.method != 'HEAD' && res.statusCode != 204  && res.statusCode != 304)switch(res.headers['content-encoding'] || res.headers['x-content-encoding']){
			case'gzip':
				res = res.pipe(zlib.createGunzip({
					flush: zlib.Z_SYNC_FLUSH,
					finishFlush: zlib.Z_SYNC_FLUSH
				}));
				
				break;
			case'deflate':
				return res.once('data', chunk =>
					res.pipe((chunk[0] & 0x0F) === 0x08 ? zlib.createInflate() : zlib.createInflateRaw()).on('data', chunk => chunks.push(chunk)).on('end', () => callback(Buffer.concat(chunks)))
				);
				
				break;
			case'br':
				res = res.pipe(zlib.createBrotliDecompress({
					flush: zlib.Z_SYNC_FLUSH,
					finishFlush: zlib.Z_SYNC_FLUSH
				}));
				
				break;
		}
		
		res.on('data', chunk => chunks.push(chunk)).on('end', () => callback(Buffer.concat(chunks))).on('error', err => console.error(err) + callback(Buffer.concat(chunks)));
	}
	/**
	* Validates a URL
	* @param {URL|String} URL to parse
	* @param {URL|String} [Base]
	* @returns {Undefined|URL} Result, is undefined if an error occured
	*/
	valid_url(...args){
		var out;
		
		try{ out = new this.URL(...args) }catch(err){}
		
		return out;
	}
	/**
	* Returns a string version of the config`
	* @returns {Object}
	*/
	str_conf(){
		return JSON.stringify({
			codec: this.config.codec.name,
			prefix: this.config.prefix,
			title: this.config.title,
			ws: this.config.ws,
		});
	}
	/**
	* Retrieves global data/creates if needed
	* @param {Object} global
	* @param {URL} url
	* @returns {Object}
	*/
	get_globals(url){
		var thjs = this;
		
		if(!global.$rw){
			global.$rw = {
				backups: new Map(),
				proxied: new Map(),
				origina: new Map(),
				proxy_o: new Set(),
				blob: new Map(),
				urls: new Map(),
				prox: '$rw.prox',
				orig: '$rw.orig',
				loc: global.location,
				get meta(){
					return {
						url: this.fixed_url || thjs.unurl(this.loc.href, thjs.empty_meta),
						origin: this.loc.origin,
						base: this.loc.origin,
					}
				},
				url: this.valid_url(this.unurl(global.location.href, this.empty_meta)),
			};
			
			if(typeof global.DedicatedWorkerGlobalScope == 'function')global.$rw.fixed_url = global.$rw.url;
	}
		
		
		
		return global.$rw;
	}
	/**
	* Globals, called in the client to set any global data or get the proper fills object
	* @param {URL} [Local URL] - needed if page URL is not set globally
	*/
	globals(url){
		var thjs = this,
			global = new (_=>_).constructor('return this')(),
			URL = this.URL,
			$rw = this.get_globals(url),
			backup = (obj, key, sub) => (sub = $rw.backups.has(obj) ? $rw.backups.get(obj) : $rw.backups.set(obj, (Object || global.Object).setPrototypeOf({}, null)), sub[key] || (sub[key] = obj[key])),
			Object = global.Object.fromEntries(global.Object.getOwnPropertyNames(global.Object).map(key => [ key, backup(global.Object, key) ])),
			Reflect = Object.fromEntries(Object.getOwnPropertyNames(global.Reflect).map(key => [ key, backup(global.Reflect, key) ])),
			Proxy = backup(global, 'Proxy'),
			Symbol = backup(global, 'Symbol'),
			arr_map = backup(Array.prototype, 'map'),
			arr_iterate = backup(Array.prototype, Symbol.iterator),
			func_bind = backup(Function.prototype, 'bind'),
			func_tostring = backup(Function.prototype, 'toString'),
			has_own_prop = backup(Object.prototype, 'hasOwnProperty'),
			def = {
				desc: (obj, prop, desc) => ($rw.proxy_o.has(obj) && (def.has_prop(desc, 'writable') && (desc.writable = true), def.has_prop(desc, 'configurable') && (desc.configurable = true), desc[def.has_prop(desc, 'value') ? 'writable' : 'configurable'] = true), desc),
				rw_data: data => Object.assign({ url: fills.url, base: fills.url, origin: def.loc }, data ? data : {}),
				handler: (tg, desc, pt) => (pt = Object.setPrototypeOf({}, null), new Proxy(pt, Object.assign(Object.defineProperties(pt, Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(tg)).map(([ key, val ]) => (val.hasOwnProperty('configurable') && (val.configurable = true), [ key, val ])))), {
					set: (t, prop, value) => Reflect.set(tg, prop, value),
					has: (t, ...a) => Reflect.has(tg, ...a),
					ownKeys: (t, ...a) => Reflect.ownKeys(tg, ...a),
					enumerate: (t, ...a) => Reflect.enumerate(tg, ...a),
					getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(pt, p),
					defineProperty: (t, prop, desc) => (Reflect.defineProperty(pt, prop, desc), Reflect.defineProperty(tg, prop, desc)),
					deleteProperty: (t, ...a) => Reflect.deleteProperty(tg, ...a),
					getPrototypeOf: t => Reflect.getPrototypeOf(tg),
					setPrototypeOf: (t, ...a) => Reflect.setPrototypeOf(tg, ...a),
					isExtensible: t => Reflect.isExtensible(tg),
					preventExtensions: t => Reflect.preventExtensions(tg),
				}, desc))),
				bind: (a, b) => Reflect.apply(func_bind, a, [ b ]),
				is_native: func => typeof func == 'function' && Reflect.apply(func_tostring, func, []).replace('\n   ', '').replace('\n}', ' }') == 'function ' + func.name + '() { [native code] }',
				has_prop: (obj, prop) => prop && obj && Reflect.apply(has_own_prop, obj, [ prop ]),
				assign_func(func, bind){
					if($rw.proxied.has(func))return $rw.proxied.get(func);
					
					var prox = Object.defineProperties(def.bind(def.is_native(func) ? new Proxy(func, { construct: (target, args, newt) => Reflect.construct(target, def.restore(...args), newt), apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)) }) : func, bind), Object.getOwnPropertyDescriptors(func));
					
					$rw.proxied.set(func, prox);
					$rw.origina.set(prox, func);
					
					return prox;
				},
				restore: (...args) => Reflect.apply(arr_map, args, [ arg => arg ? $rw.origina.get(arg) || arg : arg ]),
				proxify: (...args) => Reflect.apply(arr_map, args, [ arg => arg ? $rw.proxied.get(arg) || arg : arg ]),
				prefix: {
					origin: prop => prop.split('@').splice(-1).join(''),
					name: prop => (typeof prop != 'string' ? 'prop' : prop) + '@' + new URL(this.unurl(def.get_href().href, $rw.meta)).hostname,
					unname: (prop = '', split) => (split = prop.split('@'), split.splice(-1), split.join('')),
				},
				get_href(){ // return URL object of parent or current url
					var x = def.loc ? def.loc.href : null;
					
					if(!x || !x.hostname)try{ x = global.parent.location.href }catch(err){}
					try{ x = new URL(x) }catch(err){};
					
					return x;
				},
				url_binds: {
					replace(url){
						return def.loc.replace(thjs.url(url, { base: fills.url, origin: def.loc }));
					},
					assign(url){
						return def.loc.assign(thjs.url(url, { base: fills.url, origin: def.loc }));
					},
					reload(){
						def.loc.reload();
					},
				},
				win_binds: {
					eval: new Proxy(global.eval, { apply: (target, that, [ script ]) => Reflect.apply(target, that, [ global.rw_eval(script) ]) }),
					constructor: global.Window,
					Window: global.Window,
					get location(){ return fills.url },
					set location(value){ return fills.url.href = value },
					// origin can be a getter
					get origin(){ return fills.url.origin },
					get parent(){ try{ return global.parent.$rw.proxied.get(global.parent) }catch(err){ return fills.this } },
					get top(){ try{ return global.top.$rw.proxied.get(global.top) }catch(err){ return fills.this } },
				},
				doc_binds: {
					get location(){ return fills.url },
					set location(value){ return fills.url.href = value },
				},
			};
		
		def.loc = def.restore(global.location)[0];
		def.doc = def.restore(global.document)[0];
		
		var fills = $rw.fills = {
			def: def,
			this: def.handler(global, {
				get: (t, prop, rec, ret = Reflect.get(def.has_prop(def.win_binds, prop) ? def.win_binds : global, prop)) => $rw.proxied.get(ret) || typeof ret == 'object' && def.has_prop(ret, '$rw') && ret.$rw.fills.this || (typeof ret == 'function' ? def.assign_func(ret, global) : ret),
				set: (t, prop, value) => def.has_prop(def.win_binds, prop) ? (def.win_binds[prop] = value) : Reflect.set(global, prop, value),
			}),
			doc: def.doc ? def.handler(def.doc, {
				get: (t, prop, rec, ret) => def.has_prop(def.doc_binds, prop) ? def.doc_binds[prop] : (typeof (ret = Reflect.get(def.doc, prop))) == 'function' ? def.assign_func(ret, def.doc) : ret,
				set: (t, prop, value) => Object.getOwnPropertyDescriptor(def.doc_binds, prop) ? (def.doc_binds[prop] = value) : Reflect.set(def.doc, prop, value),
			}) : undefined,
			url: def.loc ? def.handler(def.loc, {
				get: (target, prop, ret) => {
					if(!$rw.fixed_url && def.has_prop(def.url_binds, prop))return def.url_binds[prop];
					
					var temp = this.unurl($rw.fixed_url || def.loc.href, $rw.meta);
					
					if(fills._url)fills._url.href = temp;
					else fills._url = new this.URL(temp);
					
					return typeof (ret = fills._url[prop]) == 'function' ? def.bind(ret, fills._url) : ret;
				},
				set: (target, prop, value) => {
					if($rw.fixed_url)return true; // in worker
					
					var temp = this.unurl(def.loc, { origin: def.loc.origin });
					
					if(fills._url)fills._url.href = temp;
					else fills._url = new this.URL(temp);
					
					if(temp.href != ohref)def.loc.href = this.url(temp.href, { url: this.unurl(def.loc, { origin: def.loc }), origin: def.loc });
					
					return true;
				},
			}) : undefined,
		};
		
		$rw.proxy_o.add(fills.this);
		$rw.proxy_o.add(fills.url);
		$rw.proxy_o.add(fills.doc);
		
		$rw.proxied.set(global, fills.this);
		$rw.origina.set(fills.this, global);
		
		if(def.loc){
			$rw.proxied.set(def.loc, fills.url);
			$rw.origina.set(fills.url, def.loc);
		}
		
		if(def.doc){
			$rw.proxied.set(def.doc, fills.doc);
			$rw.origina.set(fills.doc, def.doc);
		}
		
		global.rw_this = that => $rw.proxied.has(that) ? $rw.proxied.get(that) : that;
		
		fills.rw_eval = script => script ? '(()=>' + this.js('eval(' + JSON.stringify(script) + ')', $rw.meta, { global: true, append_fills: 'return ', rewrite_eval: false }) + ')()' : script;
		
		// called as argument in import()
		global.rw_url = (url, rw_fills) => {
			return this.url(url, { js: true, origin: def.loc, base: $rw.url });
		};
		
		global.prop_eval = script => eval('return(()=>' + this.js('(()=>{' + atob(decodeURIComponent(script)) + '\n})()', $rw.meta, { global: true, append_fills: 'return' }) + ')()');
		
		[
			[ 'Function', value => new Proxy(value, {
				construct: (target, args) => {
					var ref = Reflect.construct(target, args), script = args.splice(-1)[0];
					
					return Object.assign(Object.defineProperties(Reflect.construct(target, [ ...args, script ? 'return(()=>' + this.js('(()=>{' + script + '\n})()', $rw.meta, { global: true, append_fills: 'return' }) + ')()' : script ]), Object.getOwnPropertyDescriptors(ref)), { toString: def.bind(ref.toString, ref) });
				},
				apply: (target, that, args) => {
					var ref = Reflect.apply(target, that, args), script = args.splice(-1)[0];
					
					return Object.assign(Object.defineProperties(Reflect.apply(target, that, [ ...args, script ? 'return(()=>' + this.js('(()=>{' + script + '\n})()', $rw.meta, { global: true, append_fills: 'return' }) + ')()' : script ]), Object.getOwnPropertyDescriptors(ref)), { toString: def.bind(ref.toString, ref) });
				},
			}) ],
			[ 'Function', 'prototype', 'bind', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, def.is_native(that) ? def.restore(...args) : args),
			}) ],
			[ 'Function', 'prototype', 'apply', value => new Proxy(value, {
				apply: (target, that, [ tht, arg ]) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, [ def.is_native(that) ? def.restore(tht)[0] : tht, arg && def.is_native(that) && def.has_prop(arg, Symbol.iterator) ? def.restore(...Reflect.apply(arr_iterate, arg, [])) : arg ]),
			}) ],
			[ 'Function', 'prototype', 'call', value => new Proxy(value, {
				apply: (target, that, [ tht, ...args ]) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, [ def.is_native(that) ? def.restore(tht)[0] : tht, ...(args && def.is_native(that) && def.has_prop(args, Symbol.iterator) ? def.restore(...Reflect.apply(arr_iterate, args, [])) : args) ]),
			}) ],
			[ 'fetch', value => new Proxy(value, { apply: (target, that, [ url, opts ]) => Reflect.apply(target, global, [ this.url(url, $rw.meta, { route: false }), opts ]) }) ],
			[ 'Blob', value => new Proxy(value, {
				construct: (target, [ data, opts ]) => {
					var decoded = opts && this.mime.js.includes(opts.type) && Array.isArray(data) ? [ this.js(this.decode_blob(data), { url: fills.url, origin: def.loc }) ] : data,
						blob = Reflect.construct(target, [ decoded, opts ]);
					
					$rw.blob.set(blob, decoded[0]);
					
					return blob;
				},
			}) ],
			[ 'Document', 'prototype', 'write', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, [ this.html(args.join(''), $rw.meta, { snippet: true }) ]),
			}) ],
			[ 'Document', 'prototype', 'writeln', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, [ this.html(args.join(''), $rw.meta, { snippet: true }) ]),
			}) ],
			[ 'Document', 'prototype', 'open', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, args.length === 3 ? [ this.url(args[0], $rw.meta), ...args.slice(1) ] : args),
			}) ],
			[ false, 'Document', 'prototype', (value, desc, otitle) => (otitle = def.doc.title, def.doc.title = this.config.title, Object.defineProperties(value, {
				URL: { get: _ => fills.url.href },
				documentURI: { get: _ => fills.url.href },
				domain: { get: _ => fills.url.hostname },
				referrer: { get: _ => this.unurl(Reflect.apply(desc.referrer.get, def.doc, []), $rw.meta) },
				cookie: {
					get: _ => this.cookie_decode(Reflect.apply(desc.cookie.get, def.doc, []), $rw.meta),
					set: v => Reflect.apply(desc.cookie.set, global.document, [ this.cookie_encode(v, $rw.meta) ]),
				},
				title: {
					get: _ => otitle,
					set: _ => otitle = _,
				},
				defaultView: { get: _ => $rw.fills.this },
			})) ],
			[ 'WebSocket', value => new Proxy(value, {
				construct: (target, [ url, proto ]) => {
					var ws = Reflect.construct(target, [ this.url(url, $rw.meta, { ws: true }), proto ]);
					
					ws.addEventListener('message', event => event.data == 'srv-alive' && event.stopImmediatePropagation() + ws.send('srv-alive') || event.data == 'srv-open' && event.stopImmediatePropagation() + ws.dispatchEvent(new Event('open', { srcElement: ws, target: ws })));
					
					ws.addEventListener('open', event => event.stopImmediatePropagation(), { once: true });
					
					return ws
				},
			}) ],
			[ 'URL', 'createObjectURL', value => new Proxy(value, {
				apply: (target, that, [ source ]) => {
					var url = Reflect.apply(target, that, [ source ]);
					
					$rw.urls.set(url, $rw.blob.get(source));
					
					return url;
				},
			}) ],
			[ 'URL', 'revokeObjectURL', value => new Proxy(value, {
				apply: (target, that, [ url ]) => {
					var ret = Reflect.apply(target, that, [ url ]);
					
					$rw.urls.delete(url);
					
					return ret;
				},
			}) ],
			[ 'Object', 'defineProperty', value => new Proxy(value, { apply: (target, that, [ obj, prop, desc ]) => Reflect.apply(target, that, [ obj, prop, def.desc(obj, prop, desc) ]) }) ],
			[ 'Object', 'defineProperties', value => new Proxy(value, {
				apply: (target, that, [ obj, descs ]) => Reflect.apply(target, that, [ obj, Object.fromEntries(Object.keys(descs).map(prop => [ prop, def.desc(obj, prop, descs[prop]) ])) ]),
			}) ],
			[ 'Reflect', 'defineProperty', value => new Proxy(value, { apply: (target, that, [ obj, prop, desc ]) => Reflect.apply(target, that, [ obj, prop, def.desc(obj, prop, desc) ]) }) ],
			[ 'History', 'prototype', 'pushState', value => new Proxy(value, {
				apply: (target, that, [ state, title, url ]) => Reflect.apply(target, that, [ state, title, this.url(url, $rw.meta) ]),
			}) ],
			[ 'History', 'prototype', 'replaceState', value => new Proxy(value, {
				apply: (target, that, [ state, title, url ]) => Reflect.apply(target, that, [ state, title, this.url(url, $rw.meta) ]),
			}) ],
			[ 'IDBFactory', 'prototype', 'open', value => new Proxy(value, { apply: (target, that, [ name, version ]) => Reflect.apply(target, that, [ def.prefix.name(name), version ]) }) ],
			[ 'localStorage', value => (delete global.localStorage, new Proxy(value, {
				get: (target, prop, receiver, ret) => prop == $rw.orig ? target : prop == $rw.prox ? receiver : (typeof (ret = Reflect.get(target, prop)) == 'function' ? def.bind(ret, target) : target.getItem(prop)),
				set: (target, prop, value) => (target.setItem(prop, value), true),
			})) ],
			[ 'sessionStorage', value => (delete global.sessionStorage, new Proxy(value, {
				get: (target, prop, receiver, ret) => prop == $rw.orig ? target : prop == $rw.prox ? receiver : (typeof (ret = Reflect.get(target, prop)) == 'function' ? def.bind(ret, target) : target.getItem(prop)),
				set: (target, prop, value) => (target.setItem(prop, value), true),
			})) ],
			[ 'Storage', 'prototype', 'getItem', value => new Proxy(value, {
				apply: (target, that, [ prop ]) => Reflect.apply(target, that, [ def.prefix.name(prop) ]),
			}) ],
			[ 'Storage', 'prototype', 'setItem', value => new Proxy(value, {
				apply: (target, that, [ prop, value ]) => Reflect.apply(target, that, [ def.prefix.name(prop), value ]),
			}) ],
			[ 'Storage', 'prototype', 'removeItem', value => new Proxy(value, {
				apply: (target, that, [ prop, ]) => Reflect.apply(target, that, [ def.prefix.name(prop) ]),
			}) ],
			[ 'Storage', 'prototype', 'clear', value => new Proxy(value, {
				apply: (target, that) => Object.keys(that).forEach(val => def.prefix.origin(val) == fills.url.hostname && that.removeItem(prop))
			}) ],
			[ 'Storage', 'prototype', 'key', value => new Proxy(value, {
				apply: (target, that, [ key ]) => def.prefix.unname(Reflect.apply(target, that, [ key ])),
			}) ],
			[ 'importScripts', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, args.map(url => this.url(url, $rw.meta, { type: 'js' }))),
			}) ],
			[ 'XMLHttpRequest', 'prototype', 'open', value => new Proxy(value, {
				apply: (target, that, [ method, url, ...args ]) => Reflect.apply(target, that, [ method, this.url(url, $rw.meta, { route: false }), ...args ]),
			}) ],
			[ 'Navigator', 'prototype', 'sendBeacon', value => new Proxy(value, {
				apply: (target, that, [ url, data ]) => Reflect.apply(target, that, [ this.url(url, $rw.meta), data ]),
			}) ],
			[ 'window', 'open', value => new Proxy(value, {
				apply: (target, that, [ url, name, features ]) => Reflect.apply(target, that, [ this.url(url, $rw.meta), name, features ]),
			}) ],
			[ 'Worker', value => new Proxy(value, {
				construct: (target, [ url, options ]) => Reflect.construct(target, [ this.url(url, $rw.meta, {  type: 'js' }), options ]),
			}) ],
			[ 'FontFace', value => new Proxy(value, {
				construct: (target, [ family, source, descriptors ]) => Reflect.construct(target, [ family, this.url(source, $rw.meta, {  type: 'font' }), descriptors ]),
			}) ],
			[ 'ServiceWorkerContainer', 'prototype', 'register', value => new Proxy(value, {
				apply: (target, that, [ url, options ]) => new Promise((resolve, reject) => reject(new Error('A Service Worker has been blocked for this domain'))),
			}) ],
			[ 'postMessage', value => new Proxy(value, {
				apply: (target, that, [ message, origin, transfer ]) => typeof global.WorkerNavigator == 'function' ? Reflect.apply(target, that, [ message, origin, transfer ]) : Reflect.apply(target, that, [ [ 'proxied', origin, message ], def.get_href().href, transfer ]),
			}) ],
			[ 'MouseEvent', 'prototype', 'initMouseEvent', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			[ 'KeyboardEvent', 'prototype', 'initKeyboardEvent', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			[ 'Document', 'prototype', 'querySelector', value => new Proxy(value, {
				apply: (target, that, [ query ]) => Reflect.apply(target, that, [ this.css(query, $rw.meta) ]),
			}) ],
			[ 'Document', 'prototype', 'querySelectorAll', value => new Proxy(value, {
				apply: (target, that, [ query ]) => Reflect.apply(target, that, [ this.css(query, $rw.meta) ]),
			}) ],
			[ 'getComputedStyle', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, def.restore(that)[0], def.restore(...args).map(x => x instanceof Element ? x : def.doc.body)),
			}) ],
			[ 'CSSStyleDeclaration', 'prototype', 'getPropertyValue', value => new Proxy(value, {
				apply: (target, that, [ prop, value ]) => this.css(Reflect.apply(target, that, [ prop ]), $rw.meta),
			}) ],
			[ 'CSSStyleDeclaration', 'prototype', 'setProperty', value => new Proxy(value, {
				apply: (target, that, [ prop, value ]) => Reflect.apply(target, that, [ prop, this.css(value, $rw.meta, { prop: prop }) ]),
			}) ],
			// route rewritten props to the hooked function
			[ 'CSSStyleDeclaration', value => (this.attr.css_keys.forEach(prop => Object.defineProperty(value.prototype, prop, {
				get(){
					// thjs.uncss()
					return this.getPropertyValue(prop);
				},
				set(value){
					return this.setProperty(prop, thjs.css(value, $rw.meta, { keep_input: true }));
				},
			})), value) ],
			[ 'Document', 'prototype', 'createTreeWalker', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, def.restore(that)[0], def.restore(...args)),
			}) ],
			[ 'Node', 'prototype', 'contains', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			[ 'MutationObserver', 'prototype', 'observe', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			[ 'Audio', value => class extends value {
				constructor(url){
					super(thjs.url(url, { base: fills.url, origin: def.loc, route: false }));
				}
			} ],
			/*
			[ x => x ? (placeholder = x) : placeholder, value => placeholder ],
			todo: cookieStore
			*/
		].forEach(hooks => {
			for(var set_prop = typeof hooks[0] == 'boolean' ? hooks.splice(0, 1)[0] : true, new_value, callback = hooks.splice(-1)[0], depth = global, prev_depth, prev_hook, ind = 0; ind < hooks.length; ind++){
				if(!depth[hooks[ind]])return;
				
				prev_depth = depth;
				prev_hook = hooks[ind];
				depth = depth[hooks[ind]];
			}
			
			// !def.is_native(depth) || 
			if($rw.proxied.has(depth) || $rw.origina.has(depth))return;
			
			new_value = callback(depth, Object.getOwnPropertyDescriptors(depth));
			
			if(set_prop)prev_depth[prev_hook] = new_value;
			
			$rw.origina.set(new_value, depth);
			$rw.proxied.set(depth, prev_depth[prev_hook]);
		});
		
		return fills;
	}
	/**
	* Serializes a JSDOM or DOMParser object
	* @param {Document} DOM
	* @returns {String}
	*/
	html_serial(dom){
		if(module.browser)return dom.querySelector('#pro-root').innerHTML;
		
		var out, odoc = this.dom.window._document;
		
		this.dom.window._document = dom;
		
		out = this.dom.serialize();
		
		this.dom.window._document = odoc;
		
		return out;
	}
	/**
	* Wraps a string
	* @param {String}
	* @returns {String}
	*/
	wrap(str){
		return JSON.stringify([ str ]).slice(1, -1);
	}
	/**
	* Runs a checksum on a string
	* @param {String}
	* @returns {Number}
	*/
	checksum(r,e=5381,t=r.length){for(;t;)e=33*e^r.charCodeAt(--t);return e>>>0}
};