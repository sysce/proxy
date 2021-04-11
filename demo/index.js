'use strict';
var fs = require('fs'),
	path = require('path'),
	nodehttp = require('sys-nodehttp'),
	rewriter = require('../'),
	config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'))),
	server = new nodehttp.server({
		port: config.port,
		address: config.address,
		ssl: config.ssl ? {
			key: fs.readFileSync(path.join(__dirname, 'ssl.key'), 'utf8'),
			cert: fs.readFileSync(path.join(__dirname, 'ssl.crt'), 'utf8'),
		} : false,
		log_ready: true,
	}),
	rw = new rewriter({
		prefix: '/service',
		codec: rewriter.codec.xor,
		server: server,
		title: 'Service',
		interface: config.interface,
	});

server.use(nodehttp.static(path.join(__dirname, 'public'), {
	global: {
		rw: rw,
	},
}));

/*console.log(rw.js(`
test["sus" + 100]++;
console.log(window["locatio" + "n"].href);
window["locatio" + "n"] = "/";
location = "sus!!";
window[c] = "test";
window.ex = "test";

console.log(window[c]);
console.log(window.c);

location = sus;

location;

test.location;

let location = Symbol();

console.log([ location ][0] == location);

window.location;
console.log(window[location]); // null
console.log(({ [location]: {} })[location]); // {}

console.log(window[location]());

var test = { location: "sus" };

window.location += 2;

window[test] = other[prop]++;
`, { base: 'about:null', origin: 'about:null' }));

console.log(rw.css('img[src*="/test"]', { base: 'about:null', origin: 'about:null' }));
console.log(rw.css('img[src*="/test"] {}', { base: 'about:null', origin: 'about:null' }));
console.log(rw.html('<p>test</p>', { base: 'about:null', origin: 'about:null' }, { inline: true }));
*/
console.log(rw.css(`img[src*="/test"] {}

test[fake*="1"] {
	
}
`, { base: 'about:null', origin: 'about:null' }));
console.log(rw.js(`window[test][window[ok]++]`, { base: 'about:null', origin: 'about:null' }));

server.alias('/gateway', '/gateway.php');
server.alias('/prox', '/gateway.php');