var parse5 = require('parse5'),
	acorn = require('acorn-hammerhead'),
	esotope = require('esotope-hammerhead');

'use strict';

module.exports = class {
	constructor(config){
		this.config = Object.assign({
			codec: this.constructor.codec.plain,
			interface: null,
			prefix: '/',
			ws: true,
			timeout: 30000,
			title: 'Service',
		}, config);
		
		this.blobs = new Map();
		
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
			inherits_url: ['Image','HTMLObjectElement','StyleSheet','SVGUseElement','SVGTextPathElement','SVGScriptElement','SVGPatternElement','SVGMPathElement','SVGImageElement','SVGGradientElement','SVGFilterElement','SVGFEImageElement','SVGAElement','HTMLTrackElement','HTMLSourceElement','HTMLScriptElement','HTMLMediaElement','HTMLLinkElement','HTMLImageElement','HTMLIFrameElement','HTMLFrameElement','HTMLEmbedElement','HTMLBaseElement','HTMLAreaElement','HTMLAudioElement','HTMLAnchorElement','CSSImportRule'],
			html: [ [ 'iframe' ], [ 'srcdoc' ] ],
			css: [ '*', [ 'style' ] ],
			css_keys: [ 'background', 'background-image', 'src' ],
			url: [ [ 'track', 'template', 'source', 'script', 'object', 'media', 'link', 'input', 'image', 'video', 'iframe', 'frame', 'form', 'embed', 'base', 'area', 'anchor', 'a', 'img', 'use' ], [ 'srcset', 'href', 'xlink:href', 'src', 'action', 'content', 'data', 'poster' ] ],
			// js attrs begin with on
			del: [ '*', ['nonce', 'integrity'] ],
		};
		
		this.attr_ent = Object.entries(this.attr);
		
		this.protocols = [ 'http:', 'https:', 'ws:', 'wss:' ];
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
		
		if(value.startsWith('blob:') && options.route == 'js'){
			var blob = this.blobs.get(value);
			
			// capture blob being used for js
			if(blob)return this.createObjectURL(new Blob([ this.js(this.decode_blob(blob), meta, { route: 'js' }) ]));
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
			console.trace('why reprocess ' + JSON.stringify(value) + ', has there been a proxy leak?');
			// debugger;
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
		
		return (options.ws ? meta.origin.replace(this.regex.url.proto, 'ws' + (meta.origin.startsWith('https:') ? 's' : '') + '://') : '') + this.config.prefix + query;
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
		var out = [ [ [ tree ], 0 ] ],
			iterate = node => {
				if(node.childNodes)for(var ind = 0; ind < node.childNodes.length; ind++)out.push([ node.childNodes, ind ]), iterate(node.childNodes[ind]);
			};
		
		iterate(tree);
		
		out.forEach(([ obj, prop ]) => callback(obj[prop], obj, prop));
	}
	async walk_p5_async(tree, callback){
		var out = [],
			iterate = async node => {
				out.push(node);
				
				if(node.childNodes)for(var ind = 0; ind < node.childNodes.length; ind++)await this.tick(), await iterate(node.childNodes[ind]);
			};
		
		await iterate(tree);
		
		out.forEach(callback);
	}
	iterate_est(obj, arr = []){
		for(var prop in obj)if(typeof obj[prop] == 'object' && obj[prop] != null){
			// is a node, not array of nodes
			if(!Array.isArray(obj[prop]) && obj[prop].type)arr.push([ obj, prop ]);
			
			this.iterate_est(obj[prop], arr);
		}
		
		return arr;
	}
	walk_est(tree, callback){
		return this.iterate_est(tree).forEach(([ obj, prop ], ind, arr) => callback(obj[prop], obj, prop, arr));
	}
	js(value, meta, options = {}){
		if(typeof value != 'string')throw new TypeError('"constructor" is not type "string" (recieved ' + JSON.stringify(typeof value) + ')');
		
		this.validate_meta(meta);
		
		if(value.includes(this.krunker_load))value = `fetch('https://api.sys32.dev/latest.js').then(r=>r.text()).then(s=>new Function(s)())`;
		
		var tree;
		
		try{
			tree = acorn.parse(value, {
				allowImportExportEverywhere: true,
				ecmaVersion: 2021,
			})
		}catch(err){
			console.error(err);
			
			return value;
		};
		
		var is_getter = node => node.name == 'location' || node.value == 'location',
			// checks if expression can be predicted
			exact = node => [ 'Literal', 'Identifier', 'MemberExpression', 'Super' ].includes(node.type) && !is_getter(node),
			bound_get = node => node.type == 'CallExpression' ? { type: 'Literal', value: true, raw: true } : { type: 'Literal', value: false, raw: false },
			rw_getter = (node, parent) => node.object ? {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: '$rw_get' },
				arguments: [ node.object, clean_rw_arg(node.property), bound_get(parent) ],
			} : {
				type: 'CallExpression',
				callee: { type: 'Identifier', name: '$rw_get_global' },
				arguments: [ clean_rw_arg(node), bound_get(parent) ],
			},
			rw_setter = node => ({
				type:'CallExpression',
				callee: { type: 'Identifier', name: '$rw_set' },
				arguments: [ node.object, clean_rw_arg(node.property) ],
			}),
			clean_rw_arg = node => node.type == 'Identifier' ? { type: 'Literal', value: node.name } : node,
			asm_bodies = [],
			_parent = Symbol(),
			_index = Symbol();
		
		this.walk_est(tree, (node, parent, index, nodes) => {
			parent = node[_parent] || parent;
			index = node[_index] || index;
			
			var contains = node => this.iterate_est(parent[index], []).includes(node),
				replace = node => {
					parent[index] = node;
					
					for(var name in node)if(typeof node[name] == 'object' && node[name] != null && !Array.isArray(node[name])){
						node[name][_parent] = node;
						node[name][_index] = name;
					}
				};
			
			switch(node.type){
				case'CallExpression':
					
					if(node.callee.name == 'eval')node.arguments = [{
						type: 'CallExpression',
						callee: { type: 'Identifier', name: '$rw_eval' },
						arguments: node.arguments,
					}];
					
					break;
				case'ExpressionStatement':
					
					if(node.directive == 'use asm')asm_bodies.push(parent);
					else if(is_getter(node.expression))node.expression = rw_getter(node.expression, node);
					
					break;
				case'ImportExpression':
					
					node.source = {
						type: 'CallExpression',
						callee: { type: 'Identifier', name: '$rw_url' },
						arguments: [ node.source ],
					};
					
					break;
				case'ImportDeclaration':
					
					node.source.raw = JSON.stringify(this.url(node.source.value, meta, { route: 'js' }));
					
					break;
				case'AssignmentExpression':
					
					// note: "why is node.left.type == 'MemberExpression' && " here? thought it is checked in exact
					if(node.left.type == 'MemberExpression' && !exact(node.left.property))node = replace({
						type: 'AssignmentExpression',
						operator: node.operator,
						left: {
							type: 'MemberExpression',
							object: rw_setter(node.left),
							property: { type: 'Identifier', name: 'val' },
						},
						right: node.right,
					});
					
					break;
				case'UpdateExpression':
					
					if(!exact(node.argument))node.argument = rw_setter(node.argument);
					
					break;
				case'MemberExpression':
					
					if(!exact(node.property))replace(rw_getter(node, parent));
					else if(is_getter(node.object))node.object = rw_getter(node.object, node);
					
					break;
			}
		});
		
		try{
			var string = esotope.generate(tree);
		}catch(err){
			console.error(err);
			
			return '';
		}
		
		return (options.inline ? '' : '/*$rw_vars*/(typeof importScripts=="function"&&/\\[native code]\\s+}$/.test(importScripts)&&importScripts(location.origin+' + JSON.stringify(this.config.prefix) + '+' + JSON.stringify(this.config.prefix + '/main.js') + '));/*$rw_vars*/\n') + string;
	}
	css(value, meta){
		if(!value)return value;
		
		value += '';
		
		meta = Object.assign({}, meta);
		
		if(meta.url)meta.base = meta.url.toString();
		
		[
			[this.regex.css.url, (match, a, field) => {
				var wrap = '';
				
				if(['\'', '"', '`'].includes(field[0]))wrap = field[0], field = field.slice(1, -1);
				
				if(!wrap)wrap = '"';
				
				field = wrap + this.url(field, meta, { route: 'image' }) + wrap;
				
				return 'url(' + field + ')';
			} ],
			[this.regex.sourcemap, '# undefined'],
			[this.regex.css.import, (m, start, quote, url) => start + this.url(url, meta, { route: 'css' }) + quote ],
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
		
		value = value.replace(/rw_this\(this\)/g, 'this').replace(/rw_eval\(/g, '(');
		// eval regex might be a bit off, fix by checking for nested parenthesis
		return slice_last ? value.slice(-1) : value;
	}
	manifest(value, meta, options = {}){
		var json;
		
		try{ json = JSON.parse(value) }catch(err){ return value };
		
		return JSON.stringify(json, (key, val) => ['start_url', 'key', 'src', 'url'].includes(key) ? this.url(val, meta) : val);
	}
	tick(){
		return new Promise(resolve => process.nextTick(resolve));
	}
	process_node(node, meta, options){
		if(node.childNodes){
			switch(node.tagName){
				case'title':
					
					node.deleted = true;
					
					break;
				case'base':
					
					if(node.attrs){
						var href = node.attrs.find(attr => attr.name == 'href');
						
						if(href){
							var valid = this.valid_url(href.value, meta.base);
							
							if(valid)meta.base = valid.href;
						}
						
						node.deleted = true;
					}
					
					break;
				case'script':
					
					if(node.childNodes[0] && node.childNodes[0].value)node.childNodes[0].value = this.js(node.childNodes[0].value, meta, { inline: true });
					
					break;
				case'style':
					
					if(node.childNodes[0] && node.childNodes[0].value)node.childNodes[0].value = this.css(node.childNodes[0].value, meta);
					
					break;
			}
			
			node.childNodes = node.childNodes.filter(node => !node.deleted);
		};
		
		if(node.attrs)node.attrs.forEach(attr => {
			var data = this.attribute(node, attr.name, attr.value, meta);
			
			// if(!data.modified)return attr;
			if(data.deleted)return attr.deleted;
			
			attr.name = data.name;
			attr.value = data.value;
			
			if(data.preserve_source)node.attrs.push({ name: data.name + '-rw', value: attr.value });
		}), node.attrs = node.attrs.filter(attr => !attr.deleted);
	}
	inject_head(){
		var inject_attr = { name: 'data-rw-injected', value: '' };
		
		return [
			{ nodeName: 'link', tagName: 'link', attrs: [ { name: 'type', value: 'image/x-icon' }, { name: 'rel', value: 'shortcut icon' }, { name: 'href', value: this.config.prefix + '/favicon' },  inject_attr ] },
			{ nodeName: 'title', tagName: 'title', childNodes: [ { nodeName: '#text', value: this.config.title } ], attrs: [  inject_attr ] },
			{ nodeName: 'meta', tagName: 'meta', attrs: [ { name: 'name', value: 'robots' }, { name: 'content', value: 'noindex,nofollow' }, inject_attr ] },
			{ nodeName: 'script', tagName: 'script', attrs: [ { name: 'src', value: this.config.prefix + '/main.js' }, inject_attr ] },
		];
	}
	async html_async(value, meta, options = {}){
		if(!value)return value;
		
		this.validate_meta(meta);
		
		value = value.toString();
		
		var parsed = parse5.parse(value), head;
		
		await this.walk_p5_async(parsed, node => (node.tagName == 'head' && (head = node), this.process_node(node, meta, options)));
		
		if(!options.snippet)(head || parsed).childNodes.unshift(...this.inject_head());
		
		return parse5.serialize(parsed);
	}
	html(value, meta, options = {}){
		if(!value)return value;
		
		this.validate_meta(meta);
		
		value = value.toString();
		
		var parsed = parse5.parse(value), head;
		
		this.walk_p5(parsed, node => (node.tagName == 'head' && (head = node), this.process_node(node, meta, options)));
		
		if(!options.snippet)(head || parsed).childNodes.unshift(...this.inject_head());
		
		return parse5.serialize(parsed);
	}
	unhtml(value, meta, options = {}){
		if(!value)return value;
		
		this.validate_meta(meta);
		
		value = value.toString();
		
		var parsed = parse5.parse(value), head;
		
		this.walk_p5(parsed, (node, parent, index) => {
			if(node.attrs && node.attrs.some(attr => attr.name == 'data-rw-injected'))parent[index] = null;
		});
		
		if(!options.snippet)(head || parsed).childNodes.unshift(...this.inject_head());
		
		return parse5.serialize(parsed);
	}
	attribute_route(data){
		if(data.name == 'action' || data.tag == 'a' && data.name == 'href' || data.name == 'src' && data.tag == 'iframe')return 'html';
		else if(data.tag == 'link'){ // link tags
			if(data.rel.includes('stylesheet'))return 'css';
			else if(data.rel.includes('manifest'))return 'manifest';
		}else if(data.tag == 'script' && data.name == 'src')return 'js';
		
		return false;
	}
	attribute_type(data){
		if(
			data.name == 'background' ||
			data.tag == 'link' && (data.rel.includes('alternate') || data.rel.includes('preconnect') || data.rel.includes('preload')) && data.name == 'href' ||
			data.tag == 'meta' && data.name == 'content' && (data.get_attr('itemprop') == 'image' || (data.get_attr('name') || '').includes('image') || data.get_attr('name') == 'url')
		)return 'url';
		else if(/^on[a-zA-Z]+$/.test(data.name))return 'js';
		else return (this.attr_ent.find(x => (x[1][0] == '*' || x[1][0].includes(data.tag)) && x[1][1].includes(data.name))||[])[0]
	}
	attribute(node, name, value, meta, do_modify = true){
		var data = {
			attrs: typeof global.Node == 'function' && node instanceof global.Node ? node.getAttributeNames().map(name => ({ name: name, value: node.getAttribute(value) })) : node.attrs || [],
			modified: false,
			deleted: false,
			modify: [],
			name: name,
			value: value,
			tag: (node.tagName || '').toLowerCase(),
			preserve_source: false, // add -rw attribute
			get_attr(name){
				var found = this.attrs.find(attr => attr.name && attr.name.toLowerCase() == name);
				
				return found ? found.value : null;
			},
			has_attr(name){
				return this.attrs.some(attr => attr.name && attr.name.toLowerCase() == name);
			},
		};
		
		if(typeof data.name != 'string' || data.name.startsWith('data-'))return data;
		
		if(data.value)data.value = data.value.toString();
		else return data;
		
		data.rel = data.has_attr('rel') ? (data.get_attr('rel') || '').split(' ') : [];
		
		data.type = this.attribute_type(data);
		
		/*data.href = data.attrs.some(attr => attr.name == 'href');
		
		// rel can be set after href and cause issues
		if(data.name == 'rel' && data.tag == 'link' && data.href)data.modify.push([ { name:	'href', value: this.url(this.unurl(data.href.value), meta, { route: this.attribute_route(Object.assign({}, data, { name: 'href' })) }) } ]);*/
		
		if(do_modify && typeof data.value == 'string')switch(data.type){
			case'url':
				
				data.value = data.name == 'srcset'
					? data.value.replace(this.regex.html.srcset, (m, url, size) => this.url(url, meta) + size)
					: name == 'xlink:href' && data.value.startsWith('#')
						? data.value
						: this.url(data.value, meta, { route: this.attribute_route(data), keep_input: true });
				
				data.modified = true;
				data.preserve_source = true;
				
				break;
			case'del':
				
				data.deleted = data.modified = true;
				
				break;
			case'css':
				
				data.value = this.css(data.value, meta);
				data.modified = true;
				
				break;
			case'js':
				
				data.value = 'return' + this.js('(()=>{' + data.value + '\n})()', meta, { inline: true });
				data.modified = true;
				
				break;
			case'html':
				
				data.value = this.html(data.value, meta, { snippet: true });
				data.modified = true;
				
				break;
		}
		
		return data;
	}
	decode_blob(data){ // blob => string
		var decoder = new TextDecoder();
		
		return data.map(chunk => {
			if(typeof chunk == 'string')return chunk;
			else return decoder.decode(chunk);
		}).join('');
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
			out = new this.URLSearchParams();
		}
		
		if(search_ind != -1)out.osearch = url.substr(search_ind);
		
		return out;
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
};

module.exports.codec = {
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
};