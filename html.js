'use strict';
var rewriter = require('./index.js'),
	rw = new rewriter(rewrite_conf),
	$rw = rw.get_globals(global),
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
		init: global.$rw_init,
		url: $rw.url || ($rw.url = new URL($rw.url || rw.unurl(global.location.href, { origin: global.location }))),
		unnormal: arg => Array.isArray(arg) ? arg.map(pm.unnormal) : $rw.proxied.get(arg) || arg,
		frame(frame){
			if(!frame)return frame;
			
			try{
				if(!frame.$rw)frame.$rw_init = pm.init, new frame.Function('(' + pm.init + ')(' + rw.str_conf() + ')')();
				
				return frame.$rw.proxied.get(frame);
			}catch(err){
				console.error(frame, err);
				return null;
			}
		},
	},
	url_protos = [global.Image,global.HTMLObjectElement,global.StyleSheet,global.SVGUseElement,global.SVGTextPathElement,global.SVGScriptElement,global.SVGPatternElement,global.SVGMPathElement,global.SVGImageElement,global.SVGGradientElement,global.SVGFilterElement,global.SVGFEImageElement,global.SVGAElement,global.HTMLTrackElement,global.HTMLSourceElement,global.HTMLScriptElement,global.HTMLMediaElement,global.HTMLLinkElement,global.HTMLImageElement,global.HTMLIFrameElement,global.HTMLFrameElement,global.HTMLEmbedElement,global.HTMLBaseElement,global.HTMLAreaElement,global.HTMLAudioElement,global.HTMLAnchorElement,global.CSSImportRule];

[ [ global.Event, org => ({
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
}) ], [ global.Element, org => ({
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
})], [ global.HTMLIFrameElement, org => ({
	get contentWindow(){
		return pm.frame(Reflect.apply(org.contentWindow.get, this, []));
	},
	get contentDocument(){
		return (pm.frame(Reflect.apply(org.contentWindow.get, this, [])) || {}).document; 
	},
	get srcdoc(){
		return Reflect.apply(org.srcdoc.get, this, []);
	},
	set srcdoc(v){
		return Reflect.apply(org.srcdoc.set, this, [ rw.html(v, pm.rw_data()) ]);
	},
}) ], [ global.HTMLElement, org => ({
	get ownerDocument(){
		return $rw.fills.doc;
	},
}) ], [ global.Element, org => ({
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
}) ], [ global.Node, org => ({
	appendChild(node){
		var ret = Reflect.apply(org.appendChild.value, this, [ node ]);
		
		if(node && node.nodeName == 'IFRAME')node.contentWindow ? pm.frame(node.contentWindow) : node.addEventListener('load', () => pm.frame(node.contentWindow));
		
		return ret;
	},
})], [ global.MessageEvent, org => ({
	get origin(){
		var data = Reflect.apply(org.data.get, this, []);
		
		return data[0] == 'proxied' ? data[1] : Reflect.apply(org.origin.get, this, []);
	},
	get source(){
		var source = Reflect.apply(org.source.get, this, []);
		
		if(source && source.$rw)source = source.$rw.fills.this;
		
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
		// console.log(name, new URL(this.href)[name], this.href);
		
		return this.href ? new URL(this.href)[name] : this.href;
	},
	set(v){
		if(!this.href)return;
		
		var curr = new URL(this.href);
		
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
			}, attr, pm.rw_data({ keep_input: true }));
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

rw.globals();