'use strict';

if(!global._pm_)global._pm_ = { prox_vals: Object.setPrototypeOf({}, null), backups: Object.setPrototypeOf({ 'Array.prototype': [ 'indexOf', Array.prototype.indexOf ] }, null), blob_store: new Map(), url_store: new Map(), proxied: 'pm.proxied', original: 'pm.original' }

var rewriter = require('./index.js'),
	rw = new rewriter(rewrite_conf),
	pm = {
		get_href(){
			var x = global.location.href;
			
			if(!x || !x.hostname)try{
				x = global.parent.location.href;
			}catch(err){}
			
			try{ x = new URL(x) }catch(err){};
			
			return x;
		},
		rw_data: data => Object.assign({ url: pm.url, base: pm.url, origin: pm.get_href() }, data ? data : {}),
		init: global.__pm_init__,
		url: global._pm_.url || (global._pm_.url = new URL(global._pm_.url || rw.unurl(global.location.href, { origin: global.location }))),
		unnormal: arg => Array.isArray(arg) ? arg.map(pm.unnormal) : (arg && arg[_pm_.hooked]) ? arg[_pm_.hooked] : arg,
		frame(win){
			try{
				if(win && !win._pm_){
					win.__pm_init__ = pm.init;
					
					new win.Function('(' + pm.init + ')(' + rw.str_conf() + ')')();
					
					return win._pm_.fills.this;
				}
			}catch(err){
				console.error(err);
				return { fills: { this: {} } };
			}
		},
	},
	hook = win => {
		var url_protos = [win.Image,win.HTMLObjectElement,win.StyleSheet,win.SVGUseElement,win.SVGTextPathElement,win.SVGScriptElement,win.SVGPatternElement,win.SVGMPathElement,win.SVGImageElement,win.SVGGradientElement,win.SVGFilterElement,win.SVGFEImageElement,win.SVGAElement,win.HTMLTrackElement,win.HTMLSourceElement,win.HTMLScriptElement,win.HTMLMediaElement,win.HTMLLinkElement,win.HTMLImageElement,win.HTMLIFrameElement,win.HTMLFrameElement,win.HTMLEmbedElement,win.HTMLBaseElement,win.HTMLAreaElement,win.HTMLAnchorElement,win.CSSImportRule];
		
		[ [ win.Event, org => ({
			get target(){
				return pm.unnormal(Reflect.apply(org.target.get, this, []));
			},
			get srcElement(){
				return pm.unnormal(Reflect.apply(org.srcElement.get, this, []));
			},
			get currentTarget(){
				return pm.unnormal(Reflect.apply(org.currentTarget.get, this, []));
			},
			get path(){
				return pm.unnormal(Reflect.apply(org.path.get, this, []));
			},
		}) ], [ win.Document, org => ({
			get cookie(){
				return rw.cookie_decode(Reflect.apply(org.cookie.get, this, []), pm.rw_data());
			},
			set cookie(v){
				return Reflect.apply(org.cookie.set, global.document, [ rw.cookie_encode(v, pm.rw_data()) ]);
			},
			get defaultView(){
				return global._pm_.fills.this;
			},
			get referrer(){
				return rw.unurl(Reflect.apply(org.referrer.get, this, []));
			}
		}) ], [ win.Element, org => ({
			set nonce(v){ return true; },
			set integrity(v){ return true; },
			setAttribute(attr, val){
				return rw.html_attr({
					tagName: this.tagName,
					getAttribute: attr => {
						return val;
					},
					setAttribute: (attr, val) => {
						return Reflect.apply(org.setAttribute.value, this, [ attr, val ]);
					},
					removeAttribute: (attr, val) => {
						return Reflect.apply(org.removeAttribute.value, this, [ attr, val ]);
					},
				}, attr, pm.rw_data());
			},
			getAttribute(attr){
				var val = Reflect.apply(org.getAttribute.value, this, [ attr ]);
				
				return rw.attr.url[1].includes(attr) ? rw.unurl(val, { origin: global.location }) : val;
			},
			setAttributeNS(namespace, attr, val){
				return rw.attr.del[1].includes(attr) ? true : Reflect.apply(org.setAttributeNS.value, this, [ namespace, attr, rw.attr.url[1].includes(attr) ? rw.url(val, { origin: location, base: pm.url }) : val ]);
			},
			// gets called natively?!?!?!
			insertAdjacentHTML(where, html, is_pm){
				return Reflect.apply(org.insertAdjacentHTML.value, this, [ where, is_pm == 'proxied' ? html : rw.html(html, pm.rw_data({ snippet: true })) ]);
			},
		})], [ win.HTMLIFrameElement, org => ({
			set contentWindow(v){return v},
			get contentWindow(){
				return pm.frame(Reflect.apply(org.contentWindow.get, this, []));
			},
			get srcdoc(){
				return Reflect.apply(org.srcdoc.get, this, []);
			},
			set srcdoc(v){
				return Reflect.apply(org.srcdoc.set, this, [ rw.html(v, pm.rw_data()) ]);
			},
		}) ], [ win.HTMLElement, org => ({
			get style(){
				var style = Reflect.apply(org.style.get, this, []);
				
				return new Proxy(style, {
					get: (target, prop, forgot, ret = Reflect.get(style, prop)) => prop == _pm_.hooked ? style : typeof ret == 'function' ? ret.bind(style) : ret,
					set: (target, prop, value) => Reflect.set(style, prop, rw.css(value + '', pm.rw_data())),
				});
			},
			set style(v){
				return Reflect.apply(org.style.set, this, [ rw.css(v, pm.rw_data()) ]);
			},
			get ownerDocument(){
				return global._pm_.fills.doc;
			},
		}) ], [ win.Element, org => ({
			get innerHTML(){
				return Reflect.apply(org.innerHTML.get, this, []);
			},
			set innerHTML(v){
				return Reflect.apply(org.innerHTML.set, this, [ rw.html(v, pm.rw_data({ snippet: true })) ]);
			},
			get outerHTML(){
				return Reflect.apply(org.outerHTML.get, this, []);
			},
			set outerHTML(v){
				return Reflect.apply(org.outerHTML.set, this, [ rw.html(v, pm.rw_data({ snippet: true })) ]);
			},
		}) ], [ win.Node, org => ({
			appendChild(node){
				var ret = Reflect.apply(org.appendChild.value, this, [ node ]);
				
				if(node && node.nodeName == 'IFRAME')node.contentWindow ? pm.frame(node.contentWindow) : node.addEventListener('load', () => pm.frame(node.contentWindow));
				
				return ret;
			},
		})], [ win.MessageEvent, org => ({
			get origin(){
				var data = Reflect.apply(org.data.get, this, []);
				
				return data[0] == 'proxied' ? data[1] : Reflect.apply(org.origin.get, this, []);
			},
			get source(){
				var source = Reflect.apply(org.source.get, this, []);
				
				if(source && source._pm_)source = source._pm_.fills.this;
				
				return source;
			},
			get data(){
				var data = Reflect.apply(org.data.get, this, []);
				
				return data[0] == 'proxied' ? data[2] : data;
			}
		}) ] ].forEach(([ con, def ]) => Object.defineProperties(con.prototype, Object.getOwnPropertyDescriptors(def(Object.getOwnPropertyDescriptors(con.prototype)))));
		
		var org_a = Object.getOwnPropertyDescriptors(HTMLAnchorElement.prototype);
		
		["origin", "protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash"].forEach(name => Reflect.defineProperty(HTMLAnchorElement.prototype, name, {
			get(){
				var unurl = rw.unurl(this.href, { origin: global.location });
				
				return unurl ? new URL(unurl)[name] : null;
			},
			set(v){
				var curr = new URL(rw.unurl(this.href, { origin: global.location }));
				
				curr[name] = v;
				
				this.href = curr;
				
				return v;
			},
		}));
		
		url_protos.forEach(con => {
			var org = Object.getOwnPropertyDescriptors(con.prototype);
			
			rw.attr.url[1].forEach(attr => org && org[attr] && Reflect.defineProperty(con.prototype, attr, {
				get(){
					var inp = Reflect.apply(org[attr].get, this, []),
						out = rw.unurl(inp, { origin: global.location });
					
					return out || inp;
				},
				set(v){
					return rw.html_attr({
						tagName: this.tagName,
						getAttribute: attr => {
							return v;
						},
						setAttribute: (attr, val) => {
							return attr.startsWith('data-') ? (this.dataset[attr.substr(5)] = val) : Reflect.apply(org[attr].set, this, [ val ]);
						},
						removeAttribute: (attr, val) => {
							return Reflect.apply(org.removeAttribute.value, this, [ attr, val ]);
						},
					}, attr, pm.rw_data());
				},
			}));
			
			rw.attr.del[1].forEach((attr, set_val) => (set_val = 'x') && org && org[attr] && Reflect.defineProperty(con.prototype, attr, {
				get(){
					return set_val
				},
				set(v){
					return set_val = v;
				},
			}));
		});
		
		var title = win.document.title;
		
		win.document.title = rw.config.title;
		
		Reflect.defineProperty(win.document, 'title', {
			get(){
				return title;
			},
			set(v){
				return title = v;
			},
		});
		
		delete win.navigator.getUserMedia;
		delete win.navigator.mozGetUserMedia;
		delete win.navigator.webkitGetUserMedia;
		delete win.MediaStreamTrack;
		delete win.mozMediaStreamTrack;
		delete win.webkitMediaStreamTrack;
		delete win.RTCPeerConnection;
		delete win.mozRTCPeerConnection;
		delete win.webkitRTCPeerConnection;
		delete win.RTCSessionDescription;
		delete win.mozRTCSessionDescription;
		delete win.webkitRTCSessionDescription;
	};

hook(window);
rw.globals(pm.url.href, rw);

if(pm.url.origin.includes('discord.com') && pm.url.pathname == '/login'){
	var add_ele = (node_name, parent, attributes) => Object.assign(parent.appendChild(document.createElement(node_name)), attributes),
		ready = container => {
			var login_text = [...document.querySelectorAll('[class*="contents"]')].find(node => node.textContent == 'Login');
			
			if(!login_text)return;
			
			var tokenLogin = Object.assign(login_text.parentNode.parentNode.insertBefore(document.createElement('button'), login_text.parentNode.nextSibling), {
					className: 'marginBottom8-AtZOdT button-3k0cO7 button-38aScr lookFilled-1Gx00P colorBrand-3pXr91 sizeLarge-1vSeWK fullWidth-1orjjo grow-q77ONNq77ONN',
					type: 'button',
					innerHTML: '<div class="contents-18-Yxp">Token Login</div>',
				}),
				newContainer = add_ele('form', container.parentNode, {
					style: 'display:none',
					className: 'mainLoginContainer-1ddwnR',
					innerHTML: '<div class="block-egJnc0 marginTop20-3TxNs6"><div class="colorStandard-2KCXvj size14-e6ZScH h5-18_1nd title-3sZWYQ defaultMarginh5-2mL-bP">Token</div><input class="inputDefault-_djjkz input-cIJ7To" name="token" type="password" autocomplete="on" required></input><button class="marginBottom8-AtZOdT button-3k0cO7 button-38aScr lookFilled-1Gx00P colorBrand-3pXr91 sizeLarge-1vSeWK fullWidth-1orjjo grow-q77ONN"><div class="contents-18-Yxp">Login</div></button></div>',
				});
			
			add_ele('button', newContainer, {
				innerHTML: '<div class="contents-18-Yxp">Return to login</div>',
				type: 'button',
				className: 'marginTop8-1DLZ1n linkButton-wzh5kV button-38aScr lookLink-9FtZy- colorBrand-3pXr91 sizeMin-1mJd1x grow-q77ONN',
			}).addEventListener('click', () => (newContainer.style.display = 'none', container.style.display = 'block'))
			
			newContainer.addEventListener('submit', event => { // login
				event.preventDefault();
				
				add_ele('iframe', document.body).contentWindow.localStorage.setItem('token', '"' + tokenInput.value + '"');
				
				setTimeout(() => _pm_.fills.url.assign('https://discord.com/channels/@me'), 1500);
			});
			
			tokenLogin.addEventListener('click', () => (container.style.display = 'none', newContainer.style.display = 'block'));
			
			container.appendChild(document.querySelector('.marginTop4-2BNfKC'));
		},
		inv = setInterval(() => document.querySelectorAll('.mainLoginContainer-1ddwnR').forEach(node => ready(node) + clearInterval(inv)), 100);
}