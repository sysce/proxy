<?php
var data = req.method == 'GET' ? req.query : req.body,
	add_proto = url => (!/^(?:f|ht)tps?\:\/\//.test(url)) ? 'https://' + url : url,
	is_url = str => (/^https?:\/{2}|\S+\./g).test(str);

if(!data.url)echo('Missing `url` param');
else{
	var url = req.method == 'GET' ? atob(data.url) : data.url;

	url = is_url(url) ? add_proto(url) : 'https://www.google.com/search?q=' + encodeURIComponent(url);
	
	// todo: add cookie auth
	res.cookies.gateway = { value: 'sp', samesite: 'lax' };
	
	return res.redirect(rw.url(url, { origin: req.url.origin, base: 'about:' }, { route: 'html' }));
}
?>