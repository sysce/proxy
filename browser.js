var rw_bundle = this && arguments.callee.caller.caller,
	cookies = require('sys-nodehttp/cookies'),
	_rewriter = class extends require('./index.js') {
	
	hook_frame(node){
		if(!node.src && node.contentWindow)node.contentWindow.rw_bundle = rw_bundle, new node.contentWindow.Function('(' + rw_bundle + ')()')();
	}
	exec_globals(){
		if(typeof $rw_get == 'undefined'){
			var rewriter = this,
				Location = global.WorkerLocation || global.Location,
				location = global.location,
				Proxy = global.Proxy,
				URL = global.URL,
				proxied = Symbol(),
				// first argument is thisArg since call is binded
				toString = (_=>_).call.bind([].toString),
				toStringFunc = (_=>_).call.bind((_=>_).toString),
				defineProperty = Object.defineProperty,
				defineProperties = Object.defineProperties,
				getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor,
				getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors,
				getOwnPropertyNames = Object.getOwnPropertyNames,
				getPrototypeOf = Object.getPrototypeOf,
				setPrototypeOf = Object.setPrototypeOf,
				hasOwnProperty = Object.hasOwnProperty,
				fromEntries = Object.fromEntries,
				fetch = global.fetch,
				Request = global.Request,
				keys = Object.keys,
				meta = () => ({
					origin: location.origin,
					base: rewriter.unurl(location.href, this.empty_meta),
				}),
				rw_exposed_cookies = {},
				wrapped_locations = new Map(),
				wrapped_location = original => {
					var unproxied = new URL('http:a'),
						location = setPrototypeOf({}, null);
					
					if(original.reload)location.reload = original.reload;
					if(original.replace)location.replace = url => original.replace(this.url(new URL(url, meta().base).href, meta(), { route: 'html' }));
					if(original.assign)location.assign = url => original.assign(this.url(new URL(url, meta().base).href, meta(), { route: 'html' }));
					
					defineProperties(location, fromEntries(keys(getPrototypeOf(original)).concat(keys(original)).filter(prop => !hasOwnProperty.call(location, prop)).map(prop => [ prop, {
						get(){
							unproxied.href = rewriter.unurl(original.href, meta());
							
							var ret = Reflect.get(unproxied, prop);
							
							return typeof ret == 'function' ? Object.defineProperties(ret.bind(unproxied), Object.getOwnPropertyDescriptors(ret)) : ret;
						},
						set(value){
							unproxied.href = rewriter.unurl(original.href, meta());
							
							var ret = Reflect.set(unproxied, prop, value);
							
							original.href = rewriter.url(unproxied.href, meta(), { route: 'html' });
							
							return ret;
						},
					} ])));
					
					wrapped_locations.set(original, location);
					
					return location;
				},
				is_location = object => {
					var proto = object != null && typeof object == 'object' && getPrototypeOf(object);
					
					try{
						return proto && ['[object Location]', '[object WorkerLocation]'].includes(toString(proto));
					}catch(err){
						return false;
					}
				},
				rw_proxy = object => {
					if(is_location(object))return wrapped_locations.get(object) || wrapped_location(object);
					return object;
				},
				bind_proxy = (obj, obj_prox, func, prox) => prox = new Proxy(func, {
					construct(target, args){
						return Reflect.construct(target, args);
					},
					apply(target, that, args){
						return Reflect.apply(target, typeof that == 'undefined' || that == obj_prox ? obj : that, args);
					},
					get(target, prop){
						var ret = Reflect.get(target, prop);
						
						return typeof ret == 'function' ? bind_proxy(func, prox, ret) : ret;
					},
					set(target, prop, value){
						return Reflect.set(target, prop, value);
					},
				}),
				glob_evals = new Map(),
				rw_url = url => this.url(url, meta()),
				rw_get = (object, property, bound) => {
					var ret = object[property];
					
					// rw_get(parent, 'eval') 😶
					
					if(typeof ret == 'function' && /eval\(\) {\s+\[native code]\s+}$/.test(ret))return glob_evals.has(ret) ? glob_evals.get(ret) : (glob_evals.set(ret, script => ret(rw_eval(script))), glob_evals.get(ret));
					
					var out = rw_proxy(ret);
					
					if(typeof out == 'function' && bound)out = bind_proxy(object, {}, out);
					
					return out;
				},
				rw_set = (object, property) => {
					return {
						set _(value){
							if(is_location(value))return rw_proxy(object).href = value;
							
							return Reflect.set(object, property, value);
						},
					};
				},
				rw_eval = script => {
					return this.js(script, meta(), { inline: true });
				},
				rw_func = (construct, args) => {
					var decoy = construct(args),
						script = args.splice(-1)[0],
						proxied = construct([ ...args, 'return' + this.js('(()=>{' + script + '\n})()', meta(), { source: script, inline: true }) ]);
					
					defineProperty(proxied, 'length', { get: _ => decoy.length, set: _ => _ });
					proxied.toString = Function.prototype.toString.bind(decoy);
					
					return proxied;
				};
			
			this.createObjectURL = URL.createObjectURL;
			this.revokeObjectURL = URL.revokeObjectURL;
			
			global.rw$g = rw_get;
			global.rw$gg = object => is_location(object) ? rw_proxy(object) : object;
			global.rw$s = rw_set;
			global.rw$gs = set => {
				
			};
			global.$rw_proxy = rw_proxy;
			global.$rw_eval = rw_eval;
			global.$rw_url = rw_url;
			
			if(global.URL){
				if(global.URL.createObjectURL)global.URL.createObjectURL = new Proxy(global.URL.createObjectURL, {
					apply: (target, that, [ source ]) => {
						var url = Reflect.apply(target, that, [ source ]);
						
						this.blobs.set(url, this.blobs.get(source));
						
						return url;
					},
				});
				
				if(global.URL.revokeObjectURL)global.URL.revokeObjectURL = new Proxy(global.URL.revokeObjectURL, {
					apply: (target, that, [ url ]) => {
						var ret = Reflect.apply(target, that, [ url ]);
						
						this.blobs.delete(url);
						
						return ret;
					},
				});
			}
			
			if(global.Blob)global.Blob = global.Blob.prototype.constructor = new Proxy(global.Blob, {
				construct: (target, [ data, opts ]) => {
					var blob = Reflect.construct(target, [ data, opts ]);
					
					this.blobs.set(blob, data);
					
					return blob;
				},
			});
			
			if(global.Navigator)global.Navigator.prototype.sendBeacon = new Proxy(global.Navigator.prototype.sendBeacon, {
				apply: (target, that, [ url, data ]) => Reflect.apply(target, that, [ this.url(new URL(url, location).href, meta()), data ]),
			});
			
			if(global.ServiceWorkerContainer)ServiceWorkerContainer.prototype.register = new Proxy(ServiceWorkerContainer.prototype.register, {
				apply: (target, that, [ url, opts ]) => Reflect.apply(target, that, [ this.url(new URL(url, location).href, meta()), opts ]),
			});
			
			if(global.Function)global.Function = global.Function.prototype.constructor = new Proxy(global.Function, {
				apply: (target, that, args) => rw_func(args => Reflect.apply(target, that, args), args),
				construct: (target, args) => rw_func(args => Reflect.construct(target, args), args),
			});
			
			if(global.importScripts)global.importScripts = new Proxy(global.importScripts, {
				apply: (target, that, scripts) => Reflect.apply(target, that, scripts.map(script => this.url(new URL(url, location).href, meta(), { route: 'js' }))),
			});
			
			if(global.Worker)global.Worker = global.Worker.prototype.constructor = new Proxy(global.Worker, {
				construct: (target, [ url ]) => Reflect.construct(target, [ this.url(new URL(url, location).href, meta(), { route: 'js' }) ]),
			});
			
			if(global.Response){
				var resp_desc = getOwnPropertyDescriptor(global.Response, 'url');
				
				// maybe define headers too as they are changed
				defineProperty(global.Response, 'url', {
					get(){
						var value = resp_desc.call(this);
						
						return this[proxied] ? rewriter.unurl(value, meta()) : value;
					}
				});
			}
			
			if(global.fetch)global.fetch = new Proxy(global.fetch, {
				apply: (target, that, [ url, opts ]) => {
					if(toString(url) == '[object Request]')url = new Request(this.url(url.url, meta()), url);
					else url = this.url(url, meta());
					
					return new Promise((resolve, reject) => Reflect.apply(target, that, [ url, opts ]).then(res => (res[proxied] = true, resolve(res))).catch(reject));
				},
			});
			
			if(global.XMLHttpRequest)global.XMLHttpRequest = class extends global.XMLHttpRequest {
				open(method, url, ...args){
					return super.open(method, rewriter.url(new URL(url, location).href, meta()), ...args);
				}
				get responseURL(){
					return rewriter.unurl(super.responseURL, meta());
				}
			};
			
			if(global.History)global.History.prototype.pushState = new Proxy(global.History.prototype.pushState, {
				apply: (target, that, [ state, title, url = '' ]) => Reflect.apply(target, that, [ state, this.config.title, this.url(url, meta(), { route: 'html' }) ]),
			}), global.History.prototype.replaceState = new Proxy(global.History.prototype.replaceState, {
				apply: (target, that, [ state, title, url = '' ]) => Reflect.apply(target, that, [ state, this.config.title, this.url(url, meta(), { route: 'html' }) ]),
			});
			
			if(global.WebSocket)global.WebSocket = class extends global.WebSocket {
				constructor(url, proto){
					super(rewriter.url(new URL(url, location).href, meta(), { ws: true }), proto);
					
					var open;
					
					this.addEventListener('open', event => event.stopImmediatePropagation(), { once: true });
					// first packet is always `open`
					this.addEventListener('message', event => (event.stopImmediatePropagation(), this.dispatchEvent(new Event('open'))), { once: true });
				}
			};
			
			var get_sandbox_host = () => new URL(meta().base).hostname;
			
			if(global.Storage){
				var storage_sandbox = {
					instances: [ 'localStorage', 'sessionStorage' ],
					sync: Symbol(),
					get_item: global.Storage.prototype.getItem,
					set_item: global.Storage.prototype.setItem,
					proxies: new Map(),
					get(storage){
						storage = this.proxies.has(storage) ? this.proxies.get(storage) : storage;
						
						var sandbox = setPrototypeOf(JSON.parse(this.get_item.call(storage, get_sandbox_host()) || '{}'), null);
						
						sandbox[storage_sandbox.sync] = () => this.set_item.call(storage, get_sandbox_host(), JSON.stringify(sandbox));
						
						return sandbox;
					},
					args(method, minimum, value){
						if(value.length < minimum)throw new TypeError("Failed to execute '" + method + "' on 'Storoage': " + minimum + ' argument required, but only ' + value.length + ' present.');
						
						return value;
					},
				};
				
				Object.defineProperty(global.Storage.prototype, 'length', {
					get(){
						return keys(storage_sandbox.get(this)).length;
					},
				});
				
				global.Storage.prototype.key = function(...args){
					var [ index ] = storage_sandbox.args('key', 1, args);
					
					return keys(storage_sandbox.get(this))[index];
				};
				
				global.Storage.prototype.clear = function(){
					storage_sandbox.get(this)[storage_sandbox.sync]({});
				};
				
				global.Storage.prototype.removeItem = function(...args){
					var [ item ] = storage_sandbox.args('removeItem', 1, args),
						sandbox = storage_sandbox.get(this);
					
					delete sandbox[item];
					
					sandbox[storage_sandbox.sync]();
				};
				
				global.Storage.prototype.hasOwnProperty = function(item){
					return !hasOwnProperty.call(this, item) && typeof storage_sandbox.get(this)[item] != 'undefined';
				};
				
				global.Storage.prototype.getItem = function(...args){
					var [ item ] = storage_sandbox.args('getItem', 1, args);
					
					return storage_sandbox.get(this)[item];
				};
				
				global.Storage.prototype.setItem = function(...args){
					var [ item, value ] = storage_sandbox.args('setItem', 2, args),
						sandbox = storage_sandbox.get(this);
					
					sandbox[item] = value + '';
					
					sandbox[storage_sandbox.sync]();
				};
				
				defineProperties(global, fromEntries(storage_sandbox.instances.filter(storage => typeof global[storage] == 'object').map((storage, prox) => (storage_sandbox.proxies.set(prox = new Proxy(global[storage], {
					get: (target, prop, ret) => {
						var sandbox = storage_sandbox.get(target);
						
						return typeof (ret = Reflect.get(target, prop)) == 'function' ? ret : sandbox[prop]
					},
					set: (target, prop, value) => {
						var proto = getPrototypeOf(target),
							sandbox = storage_sandbox.get(target);
						
						return target.hasOwnProperty(prop) ? Reflect.set(target, prop, value) : (sandbox[prop] = value += '', sandbox[storage_sandbox.sync]());
					},
					has: (target, prop) => Reflect.has(target, prop) || typeof storage_sandbox.get(target)[prop] != 'undefined',
					ownKeys: target => keys(storage_sandbox.get(target)),
					
				}), global[storage]), [ storage, {
					get: _ => prox,
					configurable: true,
					enumerable: true,
				} ]))));
			}
			
			if(global.IDBFactory){
				global.IDBFactory.prototype.open = new Proxy(global.IDBFactory.prototype.open, {
					apply: (target, that, [ name, version ]) => Reflect.apply(target, that, [ name + '@' + get_sandbox_host(), version ]),
				});
				
				var idb_name = Object.getOwnPropertyDescriptor(global.IDBDatabase.prototype, 'name');
				
				Object.defineProperty(global.IDBDatabase.prototype, 'name', {
					get(){
						var name = idb_name.call(this);
						
						return name.split('@').split('@').slice(0, -1).join('@');
					},
				});
			}
			// dom context
			if(global.Node){
				var getAttribute = global.Element.prototype.getAttribute,
					setAttribute = global.Element.prototype.setAttribute;
				
				new global.MutationObserver(mutations => [...mutations].forEach(mutation => {
					[...mutation.addedNodes].forEach(node => node.tagName == 'IFRAME' && this.hook_frame(node));
					if(mutation.target.tagName == 'IFRAME')this.hook_frame(mutation.target);
				})).observe(document, { childList: true, attributes: true, subtree: true });
				
				global.Element.prototype.getAttribute = new Proxy(global.Element.prototype.getAttribute, {
					apply: (target, that, [ attr ]) => this.unattribute(that, attr, Reflect.apply(target, that, [ attr ]), meta(), getAttribute, setAttribute),
				});
				
				global.Element.prototype.setAttribute = new Proxy(global.Element.prototype.setAttribute, {
					apply: (target, that, [ attr, value ]) => this.attribute(that, attr, value, meta(), getAttribute, setAttribute),
				});
				
				var script_handler = desc => ({
						get(){
							return rewriter.decode_source(desc.get.call(this) || '', meta());
						},
						set(value){
							return desc.set.call(this, rewriter.js(value || '', meta()));
						},
					}),
					style_handler = desc => ({
						get(){
							return rewriter.decode_source(desc.get.call(this) || '', meta());
						},
						set(value){
							return desc.set.call(this, rewriter.css(value || '', meta()));
						},
					});
				
				defineProperties(global.HTMLScriptElement.prototype, {
					text: script_handler(getOwnPropertyDescriptor(global.HTMLScriptElement.prototype, 'text')),
					innerHTML: script_handler(getOwnPropertyDescriptor(global.Element.prototype, 'innerHTML')),
					innerText: script_handler(getOwnPropertyDescriptor(global.HTMLElement.prototype, 'innerText')),
					outerText: style_handler(getOwnPropertyDescriptor(global.HTMLElement.prototype, 'innerText')),
					textContent: script_handler(getOwnPropertyDescriptor(global.Node.prototype, 'textContent')),
				});
				
				defineProperties(global.HTMLStyleElement.prototype, {
					innerHTML: style_handler(getOwnPropertyDescriptor(global.Element.prototype, 'innerHTML')),
					innerText: style_handler(getOwnPropertyDescriptor(global.HTMLElement.prototype, 'innerText')),
					outerText: style_handler(getOwnPropertyDescriptor(global.HTMLElement.prototype, 'innerText')),
					textContent: style_handler(getOwnPropertyDescriptor(global.Node.prototype, 'textContent')),
				});
				
				var html_handler = desc => ({
					get(){
						return rewriter.unhtml(desc.get.call(this) || '', meta(), { snippet: true });
					},
					set(value){
						return desc.set.call(this, rewriter.html(value || '', meta(), { snippet: true }));
					},
				});
				
				defineProperties(global.Element.prototype, {
					innerHTML: html_handler(getOwnPropertyDescriptor(global.Element.prototype, 'innerHTML')),
					outerHTML: html_handler(getOwnPropertyDescriptor(global.Element.prototype, 'outerHTML')),
				});
				
				var titles = new Map(),
					title = getOwnPropertyDescriptor(global.Document.prototype, 'title').get;
				
				defineProperties(global.Document.prototype, {
					title: {
						get(){
							if(!titles.has(this))titles.set(this, title.call(this));
							
							return titles.get(this);
						},
						set(value){
							return titles.set(this, value);
						},
					},
					cookie: {
						get(){
							return cookies.format_object(rw_exposed_cookies).join(' ');
						},
						set: value => {
							fetch(this.config.prefix + '/cookie', {
								headers: {
									'content-type': 'application/json',
								},
								method: 'POST',
								body: JSON.stringify({
									url: new URL(meta().base).href,
									value: value,
								}),
							});
							
							return cookies.format_object(Object.assign(rw_exposed_cookies, cookies.parse_object(value, true)));
						},
					},
				});
				
				this.attr.inherits_url.forEach(prop => {
					if(!global[prop])return;
					
					var proto = global[prop].prototype,
						descs = getOwnPropertyDescriptors(proto);
					
					this.attr.url[1].forEach(attr => descs.hasOwnProperty(attr) && defineProperty(proto, attr, {
						get(){
							return this.getAttribute(attr);
						},
						set(value){
							return this.setAttribute(attr, value);
						},
					}));
					
					this.attr.del[1].forEach((attr, set_val) => (set_val = new Map()) && descs.hasOwnProperty(attr) && defineProperty(proto, attr, {
						get(){
							return set_val.has(this) ? set_val.get(this) : (set_val.set(this, getAttribute.call(this, attr)), set_val.get(this))
						},
						set(value){
							set_val.set(this, value);
							
							return value;
						},
					}));
				});
				
				defineProperties(global.HTMLAnchorElement.prototype, fromEntries(['origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].map(attr => [ attr, {
					get(){
						return new URL(this.getAttribute('href'), meta().base)[attr];
					},
					set(value){
						var curr = new URL(this.getAttribute('href'));
						
						curr[attr] = value;
						
						this.setAttribute('href', curr.ref);
						
						return value;
					},
				} ])));
				
				global.postMessage = new Proxy(global.postMessage, {
					apply: (target, that, [ data, origin, transfer ]) => Reflect.apply(target, that, [ JSON.stringify([ 'proxy', data, origin ]), location.origin, transfer ]),
				});
				
				global.addEventListener('message', event => {
					var data;
					
					try{
						data = JSON.parse(event.data);
					}catch(err){}
					
					if(!data || data[0] != 'proxy')return;
					
					defineProperties(event, {
						data: { get: _ => data[1], set: _ => _ },
						origin: { get: _ => data[2], set: _ => _ },
					});
				});
				
				delete global.navigator.getUserMedia;
				delete global.navigator.mozGetUserMedia;
				delete global.navigator.webkitGetUserMedia;
				delete global.MediaStreamTrack;
				delete global.mozMediaStreamTrack;
				delete global.webkitMediaStreamTrack;
				delete global.RTCPeerConnection;
				delete global.mozRTCPeerConnection;
				delete global.webkitRTCPeerConnection;
				delete global.RTCSessionDescription;
				delete global.mozRTCSessionDescription;
				delete global.webkitRTCSessionDescription;
			}
		}
	}
};

new _rewriter(inject_config).exec_globals();

if(typeof document == 'object' && document.currentScript)document.currentScript.remove()