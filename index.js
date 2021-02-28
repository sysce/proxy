/*server*/
var fs = require('fs'),
	dns = require('dns'),
	zlib = require('zlib'),
	util = require('util'),
	path = require('path'),
	http = require('http'),
	https = require('https'),
	WebSocket = require('./ws.js'),
	terser = require('terser'),
	jsdom = require('jsdom').JSDOM,
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
	},
	adblock = {
		filters: [],
		exceptions: [],
		test(url, type, dat){ // determines if rule matches URL and type
			// validation
			
			if(dat[2].script && type != 'js')return false;
			if(dat[2].document && type != 'html')return false;
			if(dat[2].subdocument && type != 'html')return false;
			
			if(dat[2].domain){
				/*
				domain
					[0] applies
					[1] exceptions
				*/
				
				// !dat[2].domain[0].some(domain => domain.endsWith('.' + url.host) || domain == url.host)
				if(!dat[2].domain[0].includes(url.host) || dat[2].domain[1].includes(url.host))return;
			}
			
			// regexing
			// check against url without protocol
			
			var match = url.href.substr(url.href.indexOf(url.hostname)).match(dat[1]);
			
			return match || false;
		},
		match(url, type){ // tests for exceptions and on all rules
			for(var ind = 0; ind < adblock.filters.length; ind++){
				if(adblock.test(url, type, adblock.filters[ind])){
					// match against exceptions
					for(var exp_ind = 0; exp_ind < adblock.exceptions.length; exp_ind++)if(adblock.test(url, type, adblock.exceptions[exp_ind]))return;
					
					return adblock.filters[ind];
				}
			}
		},
		parse(rule){ // turns rule into object
			var str = rule,
				com_ind = str.indexOf('! ');
			
			if(com_ind != -1)str = str.slice(0, com_ind);
			
			var opt_ind = str.lastIndexOf('$'),
				options = opt_ind == -1 ? {} : Object.fromEntries(str.substr(opt_ind + 1).split(',').map(val => val.split('=')));
			
			if(options.domain){
				var domains = options.domain.split('|'),
					applies = domains.filter(x => !x.startsWith('~')),
					excepts = domains.filter(x => x.startsWith('~'));
				
				options.domain = [ applies, excepts ];
			}
			
			if(opt_ind != -1)str = str.slice(0, opt_ind);
			
			var css_ind = str.indexOf('##');
			
			if(css_ind != -1)return; // str = str.slice(0, css_ind);
			
			var dir_ind = str.indexOf('||');
			
			if(dir_ind != -1)str = str.slice(dir_ind);
			
			// exception
			
			var exp = str.startsWith('@@');
			
			if(exp)str = str.slice(2);
			
			if(!str || str.startsWith('[') || !str.length)return;
			
			/*
			[0] string
			[1] regex
			[2] options
			[3] exception
			*/
			
			var regex = str.startsWith('/') && str.endsWith('/') ? new RegExp(str.slice(1, -1)) : new RegExp(str.replace(/[\[\]?$()\/\\|.+]/g, char => '\\' + char).replace(/\*/g, '.*?').replace(/\^/g, '([^a-zA-Z0-9_\\-.%]|^|$)'));
			
			adblock[exp ? 'exceptions' : 'filters'].push([ str, regex, options, rule ]);
		},
	};

fs.readFileSync(path.join(__dirname, 'easylist.txt'), 'utf8').split('\n').forEach(adblock.parse);

/*end_server*/

var URL = require('./url.js')

/**
* Rewriter
* @param {Object} config
* @param {Object} server - nodehttp/express server to run the proxy on, only on the serverside this is required
* @param {Boolean} [config.adblock] - Determines if the adblock.txt file should be used for checking URLs
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
			adblock: true,
			http_agent: module.browser ? null : new http.Agent({}),
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
		
		/*server*/if(this.config.server){
			if(this.config.dns)dns.setServers(this.config.dns);
			
			this.config.server_ssl = this.config.server.ssl;
			
			this.config.server.use(this.config.prefix + '*', (req, res) => {
				if(req.url.searchParams.has('html'))return res.contentType('application/javascript').send(this.preload[0] || '');
				if(req.url.searchParams.has('favicon'))return res.contentType('image/png').send(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAA', 'base64'));
				
				var url = this.valid_url(this.unurl(req.url)),
					data = { origin: req.url, url: url, base: url },
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
							headers: this.headers_encode(req.headers, data),
							method: req.method,
						}, resp => this.decompress(req, resp, body => {
							var dest = req.headers['sec-fetch-dest'],
								decoded = this.decode_params(req.url),
								content_type = (resp.headers['content-type'] || '').split(';')[0],
								type =  content_type == 'text/plain' ? 'plain' : dest == 'font' ? 'font' : decoded.has('type') ? decoded.get('type') : dest == 'script' ? 'js' : (this.mime_ent.find(([ key, val ]) => val.includes(content_type)) || [])[0],
								dec_headers = this.headers_decode(resp.headers, data);
							
							if(this.config.adblock && !failure){
								var matched = adblock.match(url, type);
								
								if(matched)return res.cgi_status(401, '<pre>EasyList has prevented the following page from loading:\n' + res.sanitize(url.href) + '\n\nBecause of the following filter:\n' + JSON.stringify(matched) + '</pre>');
							}
							
							res.status(resp.statusCode.toString().startsWith('50') ? 400 : resp.statusCode);
							
							for(var name in dec_headers)res.set(name, dec_headers[name]);
							
							clearTimeout(timeout);
							
							if(failure)return;
							
							var body = decoded.get('route') != 'false' && ['js', 'css', 'html', 'plain', 'manifest'].includes(type) ? this[type](body, data) : body;
							
							res.send(body);
						})).on('error', err => {
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
						url = this.valid_url(this.unurl(req_url));
					
					if(!url)return cli.close();
					
					var headers = this.headers_encode(req.headers, { url: url, origin: req_url, base: url }),
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
		}/*end_server*/
		
		this.dom = module.browser ? global : new jsdom();
		
		if(this.dom.window && this.dom.window.DOMParser)this.html_parser = new this.dom.window.DOMParser();
		
		this.regex = {
			js: {
				comment: /\/{2}/g,
				prw_ind: /\/\*(pmrw\d+)\*\/[\s\S]*?\/\*\1\*\//g,
				prw_ins: /\/\*pmrwins(\d+)\*\//g,
				window_assignment: /(?<![a-z])window(?![a-z])\s*?=(?!=)this/gi,
				call_this: /(\?\s*?)this(\s*?:)|()()(?<![a-zA-Z_\d'"$.])this(?![:a-zA-Z_\d'"$])/g,
				construct_this: /new rw_this\(this\)/g,
				// hooking function is more practical but cant do
				eval: /(?<![a-zA-Z0-9_$.,])(?:window\.|this)?eval(?![a-zA-Z0-9_$])/g,
				// import_exp: /(?<!['"])(import\s+[{"'`*](?!\*)[\s\S]*?from\s*?(["']))([\s\S]*?)(\2;)/g,
				// work on getting import() function through
				// (match, start, quote, url, end) 
				// export_exp: /export\s*?\{[\s\S]*?;/g,
				server_only: /\/\*server\*\/[\s\S]*?\/\*end_server\*\//g,
				sourceurl: /#\s*?sourceURL/gi,
			},
			css: {
				url: /(?<![a-z])(url\s*?\(("|'|))([\s\S]*?)\2\)/gi,
				import: /(@import\s*?(\(|"|'))([\s\S]*?)(\2|\))/gi,
				property: /(\[)(\w+)(\*?=.*?]|])/g,
			},
			html: {
				srcset: /(\S+)(\s+\d\S)/g,
				newline: /\n/g,
			},
			url: {
				proto: /^([^\/]+:)/,
				host: /(:\/+)_(.*?)_/,
				ip: /^192\.168\.|^172\.16\.|^10\.0\.|^127\.0/,
				whitespace: /\s+/g,
			},
			skip_header: /(?:^sec-websocket-key|^cdn-loop|^cf-(request|connect|ip|visitor|ray)|^real|^forwarded-|^x-(real|forwarded|frame)|^strict-transport|content-(security|encoding|length)|transfer-encoding|access-control|sourcemap|trailer)/i,
			sourcemap: /#\s*?sourceMappingURL/gi,
		};
		
		this.mime = {
			js: [ 'text/javascript', 'text/emcascript', 'text/x-javascript', 'text/x-emcascript', 'application/javascript', 'application/x-javascript', 'application/emcascript', 'application/x-emcascript' ],
			css: [ 'text/css' ],
			html: [ 'text/html' ],
			xml: [ 'application/xml', 'application/xhtml+xml', 'application/xhtml+xml' ],
		};
		
		this.mime_ent = Object.entries(this.mime);
		
		this.attr = {
			html: [ [ 'iframe' ], [ 'srcdoc' ] ],
			css: [ '*', [ 'style' ] ],
			url: [ [ 'track', 'template', 'source', 'script', 'object', 'media', 'link', 'input', 'image', 'video', 'iframe', 'frame', 'form', 'embed', 'base', 'area', 'anchor', 'a', 'img', 'use' ], [ 'srcset', 'href', 'xlink:href', 'src', 'action', 'content', 'data', 'poster' ] ],
			// js attrs begin with on
			del: [ '*', ['nonce', 'integrity'] ],
		};
		
		this.attr_ent = Object.entries(this.attr);
		
		this.protocols = [ 'http:', 'https:', 'ws:', 'wss:' ];
		
		this.http_protocols = [ 'http:', 'https:' ];
		
		/*server*/if(!module.browser){
			var mods = new bundler([
					path.join(__dirname, 'html.js'),
					path.join(__dirname, 'url.js'),
					__filename,
				]),
				compact = new bundler([ path.join(__dirname, 'url.js'), __filename ]);
			
			this.preload = ['alert("preload.js not ready!");', 0];
			
			this.bundle = async () => {
				var times = await Promise.all(mods.modules.map(data => new Promise(resolve => fs.promises.stat(data).then(data => resolve(data.mtimeMs))))).then(data => data.join(''));
				
				if(this.preload[1] == times)return;
				
				compact.run().then(code => terser.minify(code.replace(this.regex.js.server_only, ''), { mangle: { reserved: ['require', 'compact'] } })).then(data => this.compact = data.code)
				
				var _compact = await mods.run().then(code => code.replace(this.regex.js.server_only, '')),
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
			
			this.preload = [ 'alert("how!")', Date.now() ];
		}
	}
	/**
	* Prefixes a URL and encodes it
	* @param {String|URL|Request} - URL value
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @param {Object} [data.type] - The type of URL this is (eg js, css, html), helps the rewriter determine how to handle the response
	* @param {Object} [data.ws] - If the URL is a WebSocket
	* @returns {String} Proxied URL
	*/
	url(value, data = {}){
		if(data.ws && !this.config.ws)throw new TypeError('WebSockets are disabled');
		
		if(typeof value == 'undefined')return value;
		
		var oval = value;
		
		if(!data.origin)throw new TypeError('give origin');
		
		data.base = this.valid_url(data.base || this.unurl(data.origin));
		
		data.origin = this.valid_url(data.origin).origin || data.origin;
		
		if(module.browser && data.base.origin == 'null'){
			var x = global.location.href;
			
			if(!x || !x.hostname)try{ x = global.parent.location.href }catch(err){}
			
			try{ x = new thihs.URL(x) }catch(err){};
			
			data.base = x;
		}
		
		if(module.browser && value instanceof global.Request)value = value.url;
		if(typeof value == 'object')value = value.hasOwnProperty('url') ? value.url : value + '';
		
		value = value; // .replace(this.regex.url.whitespace, '');
		
		if(value.startsWith('blob:') && data.type == 'js' && module.browser){
			var raw = global.$rw.urls.get(value);
			
			if(raw)return (global.$rw.origina.get(global.URL.createObjectURL) || global.URL.createObjectURL)(new Blob([ this.js(raw, { url: data.base, origin: data.origin }) ]));
		}
		
		if(value.match(this.regex.url.proto) && !this.protocols.some(proto => value.startsWith(proto)))return value;
		
		var url = this.valid_url(value, data.base);
		
		if(!url)return value;
		
		var out = url.href,
			query = new this.URL.searchParams(),
			decoded = this.decode_params(url); // for checking
		
		if(decoded.has('url'))return value;
		
		// if(url.origin == data.origin && url.origin == data.base.origin)console.trace('origin conflict', url.href, data.base.href, data.origin);
		if(url.origin == data.origin)out = data.base.origin + url.fullpath;
		
		query.set('url', encodeURIComponent(this.config.codec.encode(out, data)));
		
		if(data.type)query.set('type', data.type);
		if(data.hasOwnProperty('route'))query.set('route', data.route);
		
		query.set('ref', this.config.codec.encode(data.base.href, data));
		
		var out = (data.ws ? data.origin.replace(this.regex.url.proto, 'ws' + (this.config.server_ssl ? 's' : '') + '://') : data.origin) + this.config.prefix + query;
		
		if(module.browser && oval instanceof global.Request)out = new global.Request(out, oval);
		
		return out;
	}
	/**
	* Attempts to decode a URL previously ran throw the URL handler
	* @param {String} - URL value
	* @returns {String} - Normal URL
	*/
	unurl(value, data = {}){;
		var decoded = this.decode_params(value);
		
		if(!decoded.has('url'))return value;
		
		var out = this.config.codec.decode(decoded.get('url'), data),
			search_ind = out.indexOf('?');
		
		if(decoded.osearch)out = out.substr(0, search_ind == -1 ? out.length : search_ind) + decoded.osearch;
		
		return out;
	}
	/**
	* Scopes JS and adds in filler objects
	* @param {String} value - JS code
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @returns {String}
	*/
	js(value, data = {}){
		value = this.plain(value, data);
		
		if(!value)return '{}';
		
		if(value.startsWith('{/*pmrw'))return value;
		
		if(value.includes(decodeURIComponent(`color%3Argba(255%2C255%2C255%2C0.4)'%3EMake%20sure%20you%20are%20using%20the%20latest%20version`)))return this.js(`fetch('https://api.brownstation.pw/token').then(r=>r.json()).then(d=>fetch('https://api.brownstation.pw/data/game.'+d.build + '.js').then(d=>d.text()).then(s=>new Function('WP_fetchMMToken',s)(new Promise(r=>r(d.token)))))`, data);
		
		// var js_imports = [], js_exports = [],
		var prws = [];
		
		if(data.rewrite != false)value = value
		.replace(this.regex.sourcemap, '# undefined')
		.replace(this.regex.js.prw_ind, match => (prws.push(match), '/*pmrwins' + (prws.length - 1) + '*/'))
		.replace(this.regex.js.call_this, '$1rw_this(this)$2')
		.replace(this.regex.js.eval, '(x=>eval(pm_eval(x)))')
		.replace(this.regex.js.construct_this, 'new(rw_this(this))')
		// move import statements
		// .replace(this.regex.js.import_exp, (match, start, quote, url, end) => (js_imports.push(start + this.url(url, data.furl, data.url) + end), ''))
		// .replace(this.regex.js.export_exp, match => (js_exports.push(match), ''))
		;
		
		var id = this.checksum(value);
		
		// js_imports.join('\n') + 
		
		if(data.scope !== false)value = '{/*pmrw' + id + '*/let fills=' + (data.global == true ? '$rw.fills' : `(new((()=>{var compact=()=>{${this.compact};return require};return compact()('./index.js')})())(${this.str_conf()})).globals(${this.wrap(data.url)})`) + ['window', 'Window', 'location', 'parent', 'top', 'self', 'globalThis', 'document', 'importScripts', 'frames'].map(key => ',' + key + '=fills.this.' + key).join('') + ';' + value.replace(this.regex.js.prw_ins, (match, ind) => prws[ind]) + '\n' + (value.match(this.regex.js.sourceurl) ? '' : '//# sourceURL=' + encodeURI((this.valid_url(data.url) + '').replace(this.regex.js.comment, '::') || 'RWVM' + id) + '\n') + ';\n/*pmrw' + id + '*/}';
		
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
		if(!value)return '';
		
		value = value.toString('utf8');
		
		[
			[this.regex.css.url, (m, start, quote = '', url) => start + this.url(url, data) + quote + ')'],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, data) + quote ],
			[this.regex.css.property, (m, start, name, end) => start + (this.attr_type(name) == 'url' ? 'data-rw' + name : name) + end ],
		].forEach(([ reg, val ]) => value = value.replace(reg, val));
		
		return value;
	}
	/**
	* Rewrites manifest JSON data, needs the data object since the URL handler is called
	* @param {String} value - Manifest code
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @returns {String}
	*/
	manifest(value, data = {}){
		var json;
		
		try{ json = JSON.parse(value) }catch(err){ return value };
		
		return JSON.stringify(json, (key, val) => ['start_url', 'key', 'src'].includes(key) ? this.url(val, data) : val);
	}
	/**
	* Parses and modifies HTML, needs the data object since the URL handler is called
	* @param {String} value - Manifest code
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Boolean} [data.snippet] - If the HTML code is a snippet and if it shouldn't have the rewriter scripts added
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} [data.base] - Base URL, default is decoded version of the origin
	* @param {Object} [data.route] - Adds to the query params if the result should be handled by the rewriter
	* @returns {String}
	*/
	html(value, data = {}){
		value = this.plain(value, data);
		
		try{
			var document = this.html_parser.parseFromString(module.browser ? '<div id="pro-root">' + value + '</div>' : value, 'text/html'),
			charset = '<meta charset="ISO-8859-1">';
		}catch(err){
			console.error(err);
			
			return 'hacker!!!\ngot:\n' + err.message;
		}
		
		document.querySelectorAll(module.browser ? '#pro-root *' : '*').forEach(node => {
			switch((node.tagName || '').toLowerCase()){
				case'meta':
					
					if(node.outerHTML.toLowerCase().includes('charset'))charset = node.outerHTML;
					
					if(node.getAttribute('http-equiv') && node.getAttribute('content'))node.setAttribute('content', node.getAttribute('content').replace(/url=(.*?$)/, (m, url) => 'url=' + this.url(url, data)));
					
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
					if(this.mime.js.includes(type) && node.innerHTML)node.textContent = this.js(node.textContent, data);
					
					break;
				case'style':
					
					node.innerHTML = this.css(node.innerHTML, data);
					
					break;
				case'base':
					
					if(node.href)data.url = data.base = new URL(node.href, this.valid_url(data.url).href);
					
					node.remove();
					
					break;
			}
			
			node.getAttributeNames().forEach(name => !name.startsWith('data-') && this.html_attr(node, name, data));
		});
		
		if(!data.snippet)document.head.insertAdjacentHTML('afterbegin', `${charset}${decodeURI('%3C')}title>${this.config.title}${decodeURI('%3C')}/title>${decodeURI('%3C')}link type='image/x-icon' rel='shortcut icon' href='.${this.config.prefix}?favicon'>${decodeURI('%3C')}script src='${this.config.prefix}?html=${this.preload[1]}'>${decodeURI('%3C')}/script>`, 'proxied');
		
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
	html_attr(node, name, data){
		var ovalue, value = node.rworig_getAttribute ? node.rworig_getAttribute(name) : node.getAttribute(name);
		
		ovalue = value;
		
		if(!value)return;
		
		value = (value + '').replace(this.regex.newline, '');
		
		var	tag = (node.tagName || '').toLowerCase(),
			attr_type = this.attr_type(name, tag);
		
		if(attr_type == 'url')node.setAttribute('data-rw' + name, value);
		
		switch(attr_type){
			case'url':
				value = name == 'srcset' ?
					value.replace(this.regex.html.srcset, (m, url, size) => this.url(url, data) + size)
					: name == 'xlink:href' && value.startsWith('#')
						? value
						: this.url(value, { origin: data.origin, base: data.base, url: data.url, type: node.rel == 'manifest' ? 'manifest' : tag == 'script' ? 'js' : null });
				break;
			case'del':
				return node.removeAttribute(name);
				break;
			case'css':
				value = this.css(value, data);
				break;
			case'js':
				value = 'prop_eval(' + this.wrap(this.constructor.codec.base64.encode(unescape(encodeURIComponent(value, data)))) + ')';
				break;
			case'html':
				value = this.html(value, { snippet: true, url: data.url, origin: data.origin });
				break;
		}
		
		try{ node.setAttribute(name, value) }catch(err){ node[name] = value };
	}
	/**
	* Soon to add removing the servers IP, mainly for converting values to strings when handling
	* @param {String|Buffer} value - Data to convert to a string
	* @param {Object} data - Standard object for all rewriter handlers
	*/
	plain(value, data){
		if(!value)return '';
		
		value = value + '';
		
		// replace ip and stuff
		
		return value;
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
			var val = typeof value[header] == 'object' ? value[header].join('') : value[header];
			
			switch(header.toLowerCase()){
				case'set-cookie':
					
					out[header] = this.cookie_encode(val, { origin: data.origin, url: data.url, base: data.base });
					
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
	/*server*/headers_encode(value, data = {}){
		// prepare headers to be sent to a request url (eg google.com)
		
		var out = {};
		
		for(var header in value){
			var val = typeof value[header] == 'object' ? value[header].join('') : value[header];
			
			switch(header.toLowerCase()){
				case'referrer':
				case'referer':
					
					out[header] = data.origin.searchParams.has('ref') ? this.config.codec.decode(data.origin.searchParams.get('ref'), data) : this.valid_url(data.url).href;
					
					break;
				case'cookie':
					
					out[header] = this.cookie_decode(val, data);
					
					break;
				case'host':
					
					out[header] = this.valid_url(data.url).host;
					
					break;
				case'sec-websocket-key': break;
				case'origin':
					
					var url;

					url = this.valid_url(this.config.codec.decode(this.decode_params(data.origin).get('ref'), data));
					
					out.Origin = url ? url.origin : this.valid_url(data.url).origin;
					
					break;
				default:
					
					if(!header.match(this.regex.skip_header))out[header] = val;
					
					break;
			}
		}
		
		out['accept-encoding'] = 'gzip, deflate'; // , br
		
		out['upgrade-insecure-requests'] = '1';
		
		delete out['cache-control'];
		
		out.host = this.valid_url(data.url).host;
		
		return out;
	}/*end_server*/
	/**
	* Prepares cookies to be sent to the client from a server, calls URL handler so 
	* @param {String} value - Cookie header
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} data.url - Base URL (needed for hostname when adding suffix)
	* @returns {Object}
	*/
	cookie_encode(value, data = {}){
		return value.split(';').map(split => {
			var split = (split + '').trim().split('=');
			
			if(split[0] == 'secure')return '';
			else if(split[0] == 'domain')split[1] = data.origin.hostname;
			else if(split[0] == 'path')split[1] = '/';
			else if(!['expires', 'path', 'httponly', 'samesite', 'max-age'].includes(split[0].toLowerCase()))split[0] += '@' + this.valid_url(data.url).hostname;
			
			
			return split[0] + (split[1] ? '=' + split[1] + ';' : ';');
		}).join(' ');
	}
	/**
	* Prepares cookies to be sent to the server from a client, calls URL handler so 
	* @param {String} value - Cookie header
	* @param {Object} data - Standard object for all rewriter handlers
	* @param {Object} data.origin - The page location or URL (eg localhost)
	* @param {Object} data.url - Base URL (needed for hostname when adding suffix)
	* @returns {Object}
	*/
	cookie_decode(value, data = {}){
		return value.split(';').map(split => {
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
			server_ssl: !!this.config.server_ssl,
			adblock: this.config.adblock,
			ws: this.config.ws,
		});
	}
	/**
	* Retrieves global data/creates if needed
	* @param {Object} global
	* @param {URL} url
	* @returns {Object}
	*/
	get_globals(global){
		if(!global.$rw)global.$rw = {
			backups: new Map(),
			proxied: new Map(),
			origina: new Map(),
			blob: new Map(),
			urls: new Map(),
			prox: '$rw.prox',
			orig: '$rw.orig',
			url: this.valid_url(this.unurl(global.location)),
		};
		
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
			$rw = this.get_globals(global),
			backup = (obj, key, sub) => (sub = $rw.backups.has(obj) ? $rw.backups.get(obj) : $rw.backups.set(obj, Object.setPrototypeOf({}, null)), sub[key] || (sub[key] = obj[key])),
			Reflect = Object.fromEntries(Object.getOwnPropertyNames(global.Reflect).map(key => [ key, backup(global.Reflect, key) ])),
			Proxy = backup(global, 'Proxy'),
			Symbol = backup(global, 'Symbol'),
			def = {
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
				bind: (a, b) => Reflect.apply(def.restore(Function.prototype.bind)[0], a, [ b ]),
				is_native: func => typeof func == 'function' && Reflect.apply(backup(Function.prototype, 'toString'), func, []).replace('\n   ', '').replace('\n}', ' }') == 'function ' + func.name + '() { [native code] }',
				has_prop: (obj, prop) => prop && obj && Reflect.apply(backup(Object.prototype, 'hasOwnProperty'), obj, [ prop ]),
				assign_func(func, bind){
					if($rw.proxied.has(func))return $rw.proxied.get(func);
					
					var prox = Object.defineProperties(def.bind(def.is_native(func) ? new Proxy(func, { construct: (target, args, newt) => Reflect.construct(target, def.restore(...args), newt), apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)) }) : func, bind), Object.getOwnPropertyDescriptors(func));
					
					$rw.proxied.set(func, prox);
					$rw.origina.set(prox, func);
					
					return prox;
				},
				restore: (...args) => Reflect.apply(backup(Array.prototype, 'map'), args, [ arg => arg ? $rw.origina.get(arg) || arg : arg ]),
				proxify: (...args) => Reflect.apply(backup(Array.prototype, 'map'), args, [ arg => arg ? $rw.proxied.get(arg) || arg : arg ]),
				prefix: {
					origin: prop => prop.split('@').splice(-1).join(''),
					name: prop => (typeof prop != 'string' ? 'prop' : prop) + '@' + new URL(this.unurl(def.get_href(), { origin: def.loc })).hostname,
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
					eval: new Proxy(global.eval, { apply: (target, that, [ script ]) => Reflect.apply(target, that, [ global.pm_eval(script) ]) }),
					constructor: global.Window,
					Window: global.Window,
					get location(){ return fills.url },
					set location(value){ return fills.url.href = value },
					get origin(){ return fills.url.origin },
					get parent(){ try{ return global.parent.$rw.proxied.get(global.parent) }catch(err){ return fills.this } },
					get top(){ try{ return global.top.$rw.proxied.get(global.top) }catch(err){ return fills.this } },
				},
				doc_binds: {
					get URL(){ return fills.url.href },
					get referrer(){ return def.doc.referrer ? new URL(thjs.unurl(def.doc.referrer, def.loc, fills.url, { origin: def.loc })||{}).href : fills.url.href },
					get location(){ return fills.url },
					set location(value){ return fills.url.href = value },
					get domain(){ return fills.url.hostname },
				},
			};
		
		// backup CRITICAL props
		backup(Function.prototype, 'toString');
		backup(Function.prototype, 'bind');
		backup(Object.prototype, 'hasOwnProperty');
		backup(Array.prototype, 'splice');
		backup(Array.prototype, 'map');
		backup(Array.prototype, Symbol.iterator);
		
		def.loc = def.restore(global.location)[0];
		def.doc = def.restore(global.document)[0];
		
		var fills = $rw.fills = {
			this: def.handler(global, {
				get: (t, prop, rec, ret) => typeof (ret = Reflect.get(def.has_prop(def.win_binds, prop) ? def.win_binds : global, prop)) == 'function' ? def.assign_func(ret, global) : ret,
				set: (t, prop, value) => def.has_prop(def.win_binds, prop) ? (def.win_binds[prop] = value) : Reflect.set(global, prop, value),
			}),
			doc: def.doc ? def.handler(def.doc, {
				get: (t, prop, rec, ret) => def.has_prop(def.doc_binds, prop) ? def.doc_binds[prop] : (typeof (ret = Reflect.get(def.doc, prop))) == 'function' ? def.assign_func(ret, def.doc) : ret,
				set: (t, prop, value) => Object.getOwnPropertyDescriptor(def.doc_binds, prop) ? (def.doc_binds[prop] = value) : Reflect.set(def.doc, prop, value),
			}) : undefined,
			_url: def.loc ? new URL(this.unurl(def.loc, { origin: def.loc })) : undefined,
			url: def.loc ? def.handler(def.loc, {
				get: (target, prop, ret) => prop == $rw.prox ? fills.url : prop == $rw.orig ? def.loc : def.has_prop(def.url_binds, prop) && def.url_binds[prop] || (fills._url.href = this.unurl(def.loc, { origin: def.loc }), typeof (ret = fills._url[prop]) == 'function' ? def.bind(ret, fills._url) : ret),
				set: (target, prop, value) => {
					fills._url.href = this.unurl(def.loc, { origin: def.loc });
					
					if(fills._url.protocol == 'blob:')return true;
					
					var ohref = fills._url.href;
					
					fills._url[prop] = value;
					
					if(fills._url.href != ohref)def.loc.href = this.url(fills._url.href, { url: this.unurl(def.loc, { origin: def.loc }), origin: def.loc });
					
					return true;
				},
			}) : undefined,
		};
		
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
		
		global.rw_this = that => def.proxify(that)[0];
		// get scope => eval inside of scope
		global.pm_eval = js => '(()=>' + this.js('return eval(' + this.wrap(this.js(js, def.rw_data({ scope: false }))) + ')', def.rw_data({ rewrite: false })) + ')()';
		global.prop_eval = data => new Function('return(_=>' + this.js(atob(decodeURIComponent(data)), def.rw_data()) + ')()')();
		
		[
			[ 'Function', value => new Proxy(value, {
				construct: (target, args) => {
					var ref = Reflect.construct(target, args), script = args.splice(-1)[0];
					
					return Object.assign(Object.defineProperties(Reflect.construct(target, [ ...args, script ? 'return(()=>' + this.js(script, { url: fills.url, origin: def.loc, base: fills.url, global: true }) + ')()' : script ]), Object.getOwnPropertyDescriptors(ref)), { toString: def.bind(ref.toString, ref) });
				},
				apply: (target, that, args) => {
					var ref = Reflect.apply(target, that, args), script = args.splice(-1)[0];
					
					return Object.assign(Object.defineProperties(Reflect.apply(target, that, [ ...args, script ? 'return(()=>' + this.js(script, { url: fills.url, origin: def.loc, base: fills.url, global: true }) + ')()' : script ]), Object.getOwnPropertyDescriptors(ref)), { toString: def.bind(ref.toString, ref) });
				},
			}) ],
			[ 'Function', 'prototype', 'bind', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, def.is_native(that) ? def.restore(...args) : args),
			}) ],
			[ 'Function', 'prototype', 'apply', value => new Proxy(value, {
				apply: (target, that, [ tht, arg ]) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, [ def.is_native(that) ? def.restore(tht)[0] : tht, arg && def.is_native(that) && def.has_prop(arg, Symbol.iterator) ? def.restore(...Reflect.apply(backup(Array.prototype, Symbol.iterator), arg, [])) : arg ]),
			}) ],
			[ 'Function', 'prototype', 'call', value => new Proxy(value, {
				apply: (target, that, [ tht, ...args ]) => Reflect.apply(target, def.is_native(that) ? def.restore(that)[0] : that, [ def.is_native(that) ? def.restore(tht)[0] : tht, ...(args && def.is_native(that) && def.has_prop(args, Symbol.iterator) ? def.restore(...Reflect.apply(backup(Array.prototype, Symbol.iterator), args, [])) : args) ]),
			}) ],
			[ 'fetch', value => new Proxy(value, {
				apply: (target, that, [ url, opts ]) => Reflect.apply(target, global, [ this.url(url, { base: fills.url, origin: def.loc, route: false }), opts ]),
			}) ],
			[ 'Blob', value => new Proxy(value, {
				construct: (target, [ data, opts ]) => {
					var decoded = opts && this.mime.js.includes(opts.type) && Array.isArray(data) ? [ this.js(this.decode_blob(data), { url: fills.url, origin: def.loc }) ] : data,
						blob = Reflect.construct(target, [ decoded, opts ]);
					
					$rw.blob.set(blob, decoded[0]);
					
					return blob;
				},
			}) ],
			[ 'Document', 'prototype', 'write', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, [ this.html(args.join(''), def.rw_data({ snippet: true })) ]),
			}) ],
			[ 'Document', 'prototype', 'writeln', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, [ this.html(args.join(''), def.rw_data({ snippet: true })) ]),
			}) ],
			[ 'WebSocket', value => new Proxy(value, {
				construct: (target, [ url, proto ]) => {
					var ws = Reflect.construct(target, [ this.url(url, def.rw_data({ ws: true })), proto ]);
					
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
			[ 'Object', 'defineProperty', value => new Proxy(value, {
				apply: (target, that, [ obj, prop, desc ]) => Reflect.apply(target, that, [ obj, prop, (obj && $rw.proxied.has(obj) && (desc[def.has_prop(desc, 'value') ? 'writable' : 'configurable'] = true), desc) ]),
			}) ],
			[ 'Object', 'defineProperties', value => new Proxy(value, {
				apply: (target, that, [ obj, descs ]) => Reflect.apply(target, that, [ obj, Object.fromEntries(Object.entries(descs).map(([ prop, desc ]) => [ prop, (obj && $rw.proxied.has(obj) && (desc[def.has_prop(desc, 'value') ? 'writable' : 'configurable'] = true), desc) ])) ]),
			}) ],
			[ 'Reflect', 'defineProperty', value => new Proxy(value, {
				apply: (target, that, [ obj, prop, desc ]) => Reflect.apply(target, that, [ obj, prop, (obj && $rw.proxied.has(obj) && (desc[def.has_prop(desc, 'value') ? 'writable' : 'configurable'] = true), desc) ]),
			}) ],
			[ 'History', 'prototype', 'pushState', value => new Proxy(value, {
				apply: (target, that, [ state, title, url ]) => Reflect.apply(target, that, [ state, title, this.url(url, { origin: def.loc, base: fills.url }) ]),
			}) ],
			[ 'History', 'prototype', 'replaceState', value => new Proxy(value, {
				apply: (target, that, [ state, title, url ]) => Reflect.apply(target, that, [ state, title, this.url(url, { origin: def.loc, base: fills.url }) ]),
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
				apply: (target, that, args) => Reflect.apply(target, that, args.map(url => this.url(url, def.rw_data({ type: 'js' })))),
			}) ],
			[ 'XMLHttpRequest', 'prototype', 'open', value => new Proxy(value, {
				apply: (target, that, [ method, url, ...args ]) => Reflect.apply(target, that, [ method, this.url(url, def.rw_data({ route: false })), ...args ]),
			}) ],
			[ 'Navigator', 'prototype', 'sendBeacon', value => new Proxy(value, {
				apply: (target, that, [ url, data ]) => Reflect.apply(target, that, [ this.url(url, def.rw_data()), data ]),
			}) ],
			[ 'open', value => new Proxy(value, {
				apply: (target, that, [ url, name, features ]) => Reflect.apply(target, that, [ this.url(url, def.rw_data()), name, features ]),
			}) ],
			[ 'Worker', value => new Proxy(value, {
				construct: (target, [ url, options ]) => Reflect.construct(target, [ this.url(url, def.rw_data({  type: 'js' })), options ]),
			}) ],
			[ 'FontFace', value => new Proxy(value, {
				construct: (target, [ family, source, descriptors ]) => Reflect.construct(target, [ family, this.url(source, def.rw_data({  type: 'font' })), descriptors ]),
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
				apply: (target, that, [ query ]) => Reflect.apply(target, that, [ this.css(query, def.rw_data()) ]),
			}) ],
			[ 'Document', 'prototype', 'querySelectorAll', value => new Proxy(value, {
				apply: (target, that, [ query ]) => Reflect.apply(target, that, [ this.css(query, def.rw_data()) ]),
			}) ],
			[ 'getComputedStyle', value => new Proxy(value, {
				apply: (target, ...vals) => Reflect.apply(target, ...def.restore(...vals)),
			}) ],
			[ 'Document', 'prototype', 'createTreeWalker', value => new Proxy(value, {
				apply: (target, ...vals) => Reflect.apply(target, ...def.restore(...vals)),
			}) ],
			[ 'Node', 'prototype', 'contains', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			[ 'MutationObserver', 'prototype', 'observe', value => new Proxy(value, {
				apply: (target, that, args) => Reflect.apply(target, that, def.restore(...args)),
			}) ],
			/*
			[ x => x ? (placeholder = x) : placeholder, value => placeholder ],
			todo: cookieStore
			*/
		].forEach(hooks => {
			for(var callback = hooks.splice(-1)[0], depth = global, prev_depth, prev_hook, ind = 0; ind < hooks.length; ind++){
				if(!depth[hooks[ind]])return;
				
				prev_depth = depth;
				prev_hook = hooks[ind];
				depth = depth[hooks[ind]];
			}
			
			// !def.is_native(depth) || 
			if($rw.proxied.has(depth) || $rw.origina.has(depth))return;
			
			$rw.origina.set(prev_depth[prev_hook] = callback(depth), depth);
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