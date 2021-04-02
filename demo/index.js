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
	});

server.use(nodehttp.static(path.join(__dirname, 'public'), {
	global: {
		rw: new rewriter({
			prefix: '/service',
			codec: rewriter.codec.xor,
			server: server,
			title: 'Service',
			interface: config.interface,
		}),
	},
}));

server.alias('/gateway', '/gateway.php');