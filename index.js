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

var parse5 = require('./lib/parse5.js'),
	syntax = require('./lib/syntax.js');

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
				
				var b64tab = {0:52,1:53,2:54,3:55,4:56,5:57,6:58,7:59,8:60,9:61,A:0,B:1,C:2,D:3,E:4,F:5,G:6,H:7,I:8,J:9,K:10,L:11,M:12,N:13,O:14,P:15,Q:16,R:17,S:18,T:19,U:20,V:21,W:22,X:23,Y:24,Z:25,a:26,b:27,c:28,d:29,e:30,f:31,g:32,h:33,i:34,j:35,k:36,l:37,m:38,n:39,o:40,p:41,q:42,r:43,s:44,t:45,u:46,v:47,w:48,x:49,y:50,z:51,'+':62,'/':63,'=':64};
				
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
			ws: true,
			timeout: 30000,
			title: 'Service',
		}, config);
		
		this.URLSearchParams = URLSearchParams;
		
		this.URL = class extends URL {
			get fullpath(){
				var path = this.href.substr(this.origin.length),
					hash = path.indexOf('#');
				
				if(hash != -1)path = path.slice(0, hash);
				
				return path;
			}
		};
		
		if(typeof this.config.codec == 'string')this.config.codec = this.constructor.codec[this.config.codec];
		
		this.empty_meta = { base: 'http:a', origin: 'about:' };
		
		/*server*/if(this.config.server){
			this.config.server.use(this.config.prefix + '*', (req, res) => {
				if(req.url.searchParams.has('globals'))return res.contentType('application/javascript').send(this.globals);
				if(req.url.searchParams.has('favicon'))return res.contentType('image/png').send(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAA', 'base64'));
				
				var url = this.valid_url(this.unurl(req.url.href, this.empty_meta)),
					meta = { url: url, origin: req.url.origin, base: url.origin },
					failure = false,
					timeout = setTimeout(() => !res.resp.sent_body && (failure = true, res.cgi_status(500, 'Timeout')), this.config.timeout);
				
				if(!url || !this.protocols.includes(url.protocol))return res.redirect('/');
				
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
								route = decoded.get('route'),
								// content_type == 'text/plain' ? 'plain' : dest == 'font' ? 'font' :  ? decoded.get('type') : dest == 'script' ? 'js' : (this.mime_ent.find(([ key, val ]) => val.includes(content_type)) || [])[0],
								dec_headers = this.headers_decode(resp.headers, meta);
							
							res.status(resp.statusCode.toString().startsWith('50') ? 400 : resp.statusCode);
							
							for(var name in dec_headers)res.set(name, dec_headers[name]);
							
							clearTimeout(timeout);
							
							if(failure)return;
							
							if(decoded.get('route') != 'false' && ['js', 'css', 'html', 'manifest'].includes(route))this.decompress(req, resp, async body => {
								if(!body.byteLength)return res.send(body);
								
								if(this[route + '_async'])route += '_async';
								
								console.time(route, Buffer.byteLength(body));
								
								body = body.toString();
								var parsed = this[route](body, meta, { global: decoded.get('global') == true, mime: content_type });
								console.timeEnd(route, Buffer.byteLength(body));
								
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
		
		/*server*/if(!module.browser){
			var mods = new bundler([
					path.join(__dirname, 'lib', 'syntax.js'),
					path.join(__dirname, 'lib', 'parse5.js'),
					__filename,
				]);
			
			this.bundle = () => mods.run().then(code => terser.minify(code.replace(this.regex.server_only, '') + 'new(require("./index.js"))(' + this.str_conf() + ').exec_globals()')).then(data => {
				this.globals = data.code;
				
				Promise.all(mods.modules.map(fs.promises.stat)).then(stats => this.globals_ts = stats.map(stat => stat.mtimeMs).join(''));
			}).catch(console.error);
			
			this.bundle();
			setInterval(this.bundle, 2000);
		}/*end_server*/
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
			query = new this.URLSearchParams(),
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
		
		return (options.ws ? meta.origin.replace(this.regex.url.proto, 'ws' + (meta.origin.startsWith('https:') ? 's' : '') + '://') : meta.origin) + this.config.prefix + query;
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
	walk_p5(tree, callback){
		var out = [],
			iterate = node => {
				out.push(node);
				
				if(node.childNodes)for(var ind = 0; ind < node.childNodes.length; ind++)iterate(node.childNodes[ind]);
			};
		
		iterate(tree);
		
		out.forEach(callback);
	}
	walk_est(tree, callback){
		var out = [],
			iterate = obj => {
				for(var prop in obj)if(typeof obj[prop] == 'object' && obj[prop] != null){
					if(!Array.isArray(obj[prop]) && obj[prop].type)out.push([ obj, prop ]);
					
					iterate(obj[prop]);
				}
			},
			cb_func = typeof callback == 'function';
		
		iterate(tree);
		
		out.forEach(([ obj, prop ], cb) => (cb = cb_func ? callback : callback[obj[prop].type]) && cb.call(callback, obj[prop], obj, prop));
	}
	js(value, meta, options = {}){
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		this.validate_meta(meta);
		
		if(value.includes(this.krunker_load))value = `fetch('https://api.sys32.dev/latest.js').then(r=>r.text()).then(s=>new Function(s)())`;
		
		var rewriter = this,
			tree = syntax.parse(value, {
				allowImportExportEverywhere: true,
				ecmaVersion: 2020,
			}),
			is_getter = node => node.name == 'location' || node.value == 'location',
			exact = node => [ 'Literal', 'Identifier', 'MemberExpression', 'Super' ].includes(node.type) && !is_getter(node),
			rw_getter = node => node.object ? {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: '$rw_get' },
				arguments: [ node.object, clean_rw_arg(node.property), ],
			} : {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: '$rw_get_global' },
				arguments: [ clean_rw_arg(node) ],
			},
			clean_rw_arg = node => node.type == 'Identifier' ? { type: 'Literal', value: node.name } : node;
		
		this.walk_est(tree, {
			CallExpression(node){
				if(node.callee.name == 'eval')node.arguments = [{
					type: 'CallExpression',
					callee: { type: 'Identifier', name: '$rw_eval' },
					arguments: node.arguments,
				}];
				// else if(is_getter(node.callee) && (!node.object || node.object.type != 'CallExpression'))node.callee = rw_getter(node.callee);
			},
			ExpressionStatement(node, parent, index){
				if(is_getter(node.expression))node.expression = rw_getter(node.expression);
			},
			ImportExpression(node){
				node.source = {
					type: 'CallExpression',
					callee: { type: 'Identifier', name: '$rw_url' },
					arguments: [ node.source ],
				};
			},
			ImportDeclaration(node){
				node.source.raw = JSON.stringify(rewriter.url(node.source.value, meta, { route: 'js' }));
			},
			AssignmentExpression(node, parent, index){
				if(node.left.type == 'MemberExpression' && !exact(node.left.property))parent[index] = {
					type: 'AssignmentExpression',
					operator: node.operator,
					left: {
						type: 'MemberExpression',
						object: {
							type:'CallExpression',
							callee: { type: 'Identifier', name: '$rw_set' },
							arguments: [ node.left.object, clean_rw_arg(node.left.property) ],
						},
						property: { type: 'Identifier', name: 'val' },
					},
					right: node.right,
				};
			},
			MemberExpression(node, parent, index){
				if(!exact(node.property))parent[index] = {
					type: 'CallExpression',
					callee: { type: 'Identifier', name: '$rw_get' },
					arguments: [ node.object, clean_rw_arg(node.property) ],
				};
				else if(is_getter(node.object))node.object = rw_getter(node.object);
			},
		});
		
		return (options.inline ? '' : `/*$rw_vars*/(typeof importScripts=="function"&&/\\[native code]\s+}$/.test(importScripts)&&importScripts("?globals=${this.globals_ts}"));/*$rw_vars*/\n`) + syntax.string(tree);
	}
	css(value, data = {}){
		if(!value)return value;
		
		value += '';
		
		[
			[this.regex.css.url, (match, a, field) => {
				var wrap = '';
				
				if(['\'', '"', '`'].includes(field[0]))wrap = field[0], field = field.slice(1, -1);
				
				if(!wrap)wrap = '"';
				
				field = wrap + this.url(field, data, { route: 'image' }) + wrap;
				
				return 'url(' + field + ')';
			} ],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, data, { route: 'css' }) + quote ],
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
				
				field = wrap + this.unurl(field, meta, { route: 'image' }) + wrap;
				
				return 'url(' + field + ')';
			} ],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, data, { route: 'css' }) + quote ],
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
		
		var parsed = parse5.parse(value),
			head;
		
		this.walk_p5(parsed, node => {
			switch(node.tagName){
				case'title':
					
					node.childNodes = [ { nodeName: '#text', value: this.config.title } ];
					
					break;
				case'head':
					
					head = node;
					
					break;
				case'script':
					
					if(node.childNodes[0] && node.childNodes[0].value)console.log(node.childNodes), node.childNodes = [ { nodeName: '#text', value: this.js(node.childNodes[0].value, meta, { inline: true }) } ];
					
					break;
			}
		});
		
		if(!options.snippet)(head || parsed).childNodes.unshift({ nodeName: 'script', tagName: 'script', attrs: [ { name: 'src', value: '?globals=' + this.globals_ts } ] }, { nodeName: 'link', tagName: 'link', attrs: [ { name: 'type', value: 'image/x-icon' }, { name: 'rel', value: 'shortcut icon' }, { name: 'href', value: '?favicon' } ] });
		
		return parse5.serialize(parsed);
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
		
		document.querySelectorAll(module.browser ? '#pro-root *' : '*').forEach(node => {
			switch((node.tagName || '').toLowerCase()){
				case'meta':
					
					if(node.outerHTML.toLowerCase().includes('charset'))charset = node.outerHTML;
					
					if(node.getAttribute('http-equiv') && node.getAttribute('content'))node.setAttribute('content', node.getAttribute('content').replace(/url=(.*?$)/, (m, url) => 'url=' + this.url(url, meta)));
					
					// node.remove();
					
					break;
				case'title':
					
					node.textContent = this.config.title;
					
					break;
				case'link':
					
					if(node.rel && node.rel.includes('icon'))node.remove();
					// else if(node.rel == 'manifest')node.href = this.url(node.href, { origin: data.url, base: data.base, type: 'manifest' });
					
					break;
				case'script':
					
					if(node.textContent)node.textContent = this.js(node.textContent, meta, { inline: true });
					
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
		
		if(!options.snippet && document.head)document.head.insertAdjacentHTML('afterbegin', `${charset}${decodeURI('%3C')}link type='image/x-icon' rel='shortcut icon' href='?favicon'>${decodeURI('%3C')}script src='?globals=${this.globals_ts}'>${decodeURI('%3C')}/script>`, 'proxied');
		
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
		
		var	tag = node.tagName.toLowerCase(),
			attr_type = this.attr_type(name, tag);
		
		node.setAttribute(name + '-rw', value);
		
		switch(attr_type){
			case'url':
				value = name == 'srcset' ?
					value.replace(this.regex.html.srcset, (m, url, size) => this.url(url, meta) + size)
					: name == 'xlink:href' && value.startsWith('#')
						? value
						: this.url(value, meta, { route: node.rel == 'manifest' ? 'manifest' : tag == 'script' ? 'js' : false });
				break;
			case'del':
				return node.removeAttribute(name);
				break;
			case'css':
				value = this.css(value, meta);
				break;
			case'js':
				value = '$rw_eval_prop(' + this.wrap(this.constructor.codec.base64.encode(unescape(encodeURIComponent(value)))) + ')';
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
					
					out[header] = this.url(val, { origin: data.origin, url: data.url, base: data.base }, { route: 'html' });
					
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
			out = new this.URLSearchParams(decodeURIComponent(url.substr(start, search_ind == -1 ? url.length : search_ind)));
		}catch(err){
			// console.error(err);
			out = new this.URLSearchParams();
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
	exec_globals(){
		if(typeof $rw_get == 'undefined'){
			var rewriter = this,
				Location = global.WorkerLocation || global.Location,
				location = global.location,
				Proxy = global.Proxy,
				URL = global.URL,
				importScripts = global.importScripts,
				defineProperty = Object.defineProperty,
				defineProperties = Object.defineProperties,
				getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor,
				getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors,
				getOwnPropertyNames = Object.getOwnPropertyNames,
				getPrototypeOf = Object.getPrototypeOf,
				setPrototypeOf = Object.setPrototypeOf,
				hasOwnProperty = Object.hasOwnProperty,
				keys = Object.keys,
				meta = () => ({
					origin: location.origin,
					base: rewriter.unurl(location.href, this.empty_meta),
				}),
				wrapped_locations = new Map(),
				wrapped_location = original => {
					var unproxied = new URL('http:a'),
						location = setPrototypeOf({}, null);
					
					if(original.reload)location.reload = original.reload;
					if(original.replace)location.replace = url => original.replace(this.url(new URL(url, new URL(rewriter.unurl(original.href, meta()))).href, meta()));
					if(original.assign)location.assign = url => original.assign(this.url(new URL(url, original).href, meta()));
					
					defineProperties(location, Object.fromEntries(keys(getPrototypeOf(original)).concat(keys(original)).filter(prop => !hasOwnProperty.call(location, prop)).map(prop => [ prop, {
						get(){
							unproxied.href = rewriter.unurl(original.href, meta());
							
							var ret = Reflect.get(unproxied, prop);
							
							return typeof ret == 'function' ? Object.defineProperties(ret.bind(original), Object.getOwnPropertyDescriptors(ret)) : ret;
						},
						set(value){
							unproxied.href = rewriter.unurl(original.href, meta());
							
							var ret = Reflect.set(unproxied, prop, value);
							
							original.href = rewriter.url(unproxied.href, meta());
							
							return ret;
						},
					} ])));
					
					wrapped_locations.set(original, location);
					
					return location;
				},
				rw_proxy = object => {
					if(object instanceof Location)return wrapped_locations.get(object) || wrapped_location(object);
					return object;
				},
				rw_url = url => this.url(url, meta()),
				rw_get = (object, property) => {
					var ret = Reflect.get(object, property);
					
					if(ret == global.eval && object == global)ret = script => eval(rw_eval(script));
					
					var out = rw_proxy(ret);
					
					if(typeof out == 'function')out = Object.defineProperties(out.bind(object), Object.getOwnPropertyDescriptors(out));
					
					return out;
				},
				rw_set = (object, property) => {
					return {
						set val(value){
							var target = Reflect.get(object, property);
							
							if(target instanceof Location)return rw_proxy(target).href = value;
							
							return Reflect.set(object, property, value);
						},
					};
				},
				rw_eval = script => {
					return this.js(script, meta(), { inline: true });
				},
				rw_eval_prop = data => {
					return rw_eval(this.constructor.codec.base64.decode(decodeURIComponent(value)));
				},
				rw_Response = class extends Response {
					get url(){
						return rewriter.unurl(super.url, meta());
					}
				},
				rw_func = (construct, args) => {
					var decoy = construct(args),
						script = args.splice(-1)[0],
						proxied = construct([ ...args, '(' + this.js('()=>{' + script + '}', meta(), { inline: true }).slice(0, -1) + ')()' ]);
					
					defineProperty(proxied, 'length', { get: _ => decoy.length, set: _ => _ });
					proxied.toString = Function.prototype.toString.bind(decoy);
					
					return proxied;
				};
			
			global.$rw_get = rw_get;
			global.$rw_get_global = property => rw_get(global, property);
			global.$rw_set = rw_set;
			global.$rw_proxy = rw_proxy;
			global.$rw_eval = rw_eval;
			global.$rw_eval_prop = rw_eval_prop;
			global.$rw_url = rw_url;
			
			if(global.Navigator)global.Navigator.prototype.sendBeacon = new Proxy(global.Navigator.prototype.sendBeacon, {
				apply: (target, that, [ url, data ]) => Reflect.apply(target, that, [ this.url(new URL(url, location).href, meta(), data) ]),
			});
			
			if(global.Function)global.Function = new Proxy(global.Function, {
				apply: (target, that, args) => rw_func(args => Reflect.apply(target, that, args), args),
				construct: (target, args) => rw_func(args => Reflect.construct(target, args), args),
			});
			
			if(global.importScripts)global.importScripts = new Proxy(global.importScripts, {
				apply: (target, that, [ url ]) => Reflect.apply(target, that, [ this.url(new URL(url, location).href, meta(), { route: 'js' }) ]),
			});
			
			if(global.Worker)global.Worker = new Proxy(global.Worker, {
				apply: (target, that, [ url ]) => Reflect.apply(target, that, [ this.url(new URL(url, location).href, meta(), { route: 'js' }) ]),
			});
			
			if(global.fetch)global.fetch = new Proxy(global.fetch, {
				apply: (target, that, [ url, opts ]) => new Promise((resolve, reject) => Reflect.apply(target, that, [ this.url(url, meta()), opts ]).then(res => resolve(setPrototypeOf(res, rw_Response.prototype))).catch(reject)),
			});
			
			if(global.XMLHttpRequest)global.XMLHttpRequest = class extends global.XMLHttpRequest {
				open(method, url, ...args){
					return super.open(method, rewriter.url(new URL(url, location).href, meta()), ...args);
				}
				get responseURL(){
					return rewriter.unurl(super.responseURL, meta());
				}
			};
			
			if(global.History){
				global.History.prototype.pushState = new Proxy(global.History.prototype.pushState, {
					apply: (target, that, [ state, title, url = '' ]) => Reflect.apply(target, that, [ state, this.config.title, this.url(url, meta(), { route: 'html' }) ]),
				});
				
				global.History.prototype.replaceState = new Proxy(global.History.prototype.replaceState, {
					apply: (target, that, [ state, title, url = '' ]) => Reflect.apply(target, that, [ state, this.config.title, this.url(url, meta(), { route: 'html' }) ]),
				});
			}
		}
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