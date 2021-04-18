'use strict';
var util = require('util'),
	html = (value, inline = true) => {
		// wipe cache
		for(var mod in require.cache)delete require.cache[mod];
		
		// your code here
		
		return new (require('.'))({
			prefix: '/proxy',
		}).html(value, {
			origin: 'http://localhost:8080',
			base: 'http://domain.tld',
		}, { inline: inline });
	},
	unhtml = (value, inline = true) => {
		// wipe cache
		for(var mod in require.cache)delete require.cache[mod];
		
		// your code here
		
		return new (require('.'))({
			prefix: '/proxy',
		}).unhtml(value, {
			origin: 'http://localhost:8080',
			base: 'http://domain.tld',
		}, { inline: inline });
	},
	diff_init = function(){
		_interface.clear();
		
		_interface.write('\n\nProcessing...');
		
		var time = perf_hooks.performance.now(),
			input = this.list_data.repeat(1000),
			result = html(input);
		
		this.list_data = [ perf_hooks.performance.now() - time, Buffer.byteLength(input), Buffer.byteLength(result) ];
	},
	diff_update = function(){
		var diff = this.list_data[2] - this.list_data[1],	
			perc = ~~((diff / this.list_data[1]) * 100),
			result = this.list_data[2] + '',
			input = (this.list_data[1] + '').padStart(result.length, ' '),
			ms = (this.list_data[0] / 1000).toFixed(2);
		
		return `Input size : ${input} bytes\nResult size: ${result} bytes\n\nDifference: ${diff} bytes (${perc}%)\n\nTime: ${ms}s`
	},
	leaksret = (snippet, inline = true) => ({
		list_init(){
			this.list_data = html(snippet, inline);
		},
		list_update(){
			try{
				return `== Original: ==\n\n${snippet}\n\n== Proxied: ==\n\n${this.list_data}`;
			}catch(err){
				return `An error occured:\n\n${util.format(err)}`;
			}
		},
	}),
	perf_hooks = require('perf_hooks'),
	entries = {
		list_title: 'Proxy tester',
		Accuracy: {
			Restoration: {
				list_update(){
					var input = `<img src="http://domain.tld/testimage.png" alt="cool image check it out" style="background:url(http://domain.tld/otherbg.jpg)">`,
						transformed = html(input),
						restored = unhtml(transformed);

					return `does transformed differ from input?: ${input == transformed}
does restored differ from transformed?: ${restored == transformed}
does restored differ from input?: ${restored != input}

Above tests should all result in false

Original value can be restored in MOST cases where syntax does not need correction
Correction of syntax would go unnoticed in client JS as theres no way to determine the difference 
Its generally bad practice to check if innerHTML or outerHTML are equal to a string because of different browser parsers

Transformed:

${transformed}

Input:

${input}

Restored:

${restored}`;
				}
			},
		},
		Performance: {
			list_title: 'Performance related tests',
			'Massive set of images': {
				list_data: `<img src="http://domain.tld/image.png">`,
				list_init: diff_init,
				list_update: diff_update,
			},
			'Massive set of scripts': {
				list_data: `<script>
if(parent.location.href != window["loc" + (1 ? "at" : "asdjka") + "ion"].href){
	alert("Running in an iframe!");
	
	location.assign("http://domain.tld");
}else{
	localStorage.setItem("key", "value");
	
	this["locat" + (1 ? "ion" : "er")].assign("/");
}
</script>`,
				list_init: diff_init,
				list_update: diff_update,
			},
			'Massive set of styles': {
				list_data: `<div class="image-test"></div>

<style>
* {
	--leak: url("/image.png");
}

.image-test {
	background: var(--leak);
}

.image-test::after {
	content: ' ';
	background: url("/image.png");
}
</style>`,
				list_init: diff_init,
				list_update: diff_update,
			},
			
		},
		Leaks: {
			list_title: 'Provided by https://github.com/cure53/HTTPLeaks',
			// bool below indicates not inline
			Doctype: leaksret("<!DOCTYPE html SYSTEM \"https://leaking.via/doctype\">"),
			'HTML manifest': leaksret("<html xmlns=\"http://www.w3.org/1999/xhtml\" manifest=\"https://leaking.via/html-manifest\">"),
			'Head profile': leaksret("<head profile=\"https://leaking.via/head-profile\">"),
			Base: leaksret("<base href=\"https://leaking.via/base-href/\">"),
			'MSIE Imports': leaksret("<?IMPORT namespace=\"myNS\" implementation=\"https://leaking.via/import-implementation\" ?>\n<IMPORT namespace=\"myNS\" implementation=\"https://leaking.via/import-implementation-2\" />"),
			Redirects: leaksret("<meta http-equiv=\"refresh\" content=\"10; url=https://leaking.via/meta-refresh\">"),
			CSP: leaksret("<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self'; report-uri https://leaking.via/meta-csp-report-uri\">\n<meta http-equiv=\"Content-Security-Policy-Report-Only\" content=\"script-src 'self'; report-uri https://leaking.via/meta-csp-report-uri-2\">"),
			'Reading View': leaksret("<meta name=\"copyright\" content=\"<img src='https://leaking.via/meta-name-copyright-reading-view'>\">\n<meta name=\"displaydate\" content=\"<img src='https://leaking.via/meta-name-displaydate-reading-view'>\">\n<meta property=\"og:site_name\" content=\"<img src='https://leaking.via/meta-property-reading-view'>\">"),
			'AppLink Web Fallback': leaksret("<meta property=\"al:web:url\" content=\"https://leaking.via/meta-property-al-web-url\">"),
			'Pinned Websites': leaksret("<meta name=\"msapplication-config\" content=\"https://leaking.via/meta-name-msa-config\">\n<meta name=\"msapplication-badge\" content=\"frequency=30; polling-uri=https://leaking.via/meta-name-msa-badge\">\n<meta name=\"msapplication-notification\" content=\"frequency=60;polling-uri=https://leaking.via/meta-name-msa-notification\">\n<meta name=\"msapplication-square150x150logo\" content=\"https://leaking.via/meta-name-msa-logo-1\">\n<meta name=\"msapplication-square310x310logo\" content=\"https://leaking.via/meta-name-msa-logo-2\">\n<meta name=\"msapplication-square70x70logo\" content=\"https://leaking.via/meta-name-msa-logo-3\">\n<meta name=\"msapplication-wide310x150logo\" content=\"https://leaking.via/meta-name-msa-logo-4\">\n<meta name=\"msapplication-task\" content=\"name=Leak;action-uri=https://leaking.via/meta-name-msa-task;icon-uri=https://leaking.via/meta-name-msa-task-icon\">\n<meta name=\"msapplication-TileImage\" content=\"https://leaking.via/meta-name-msa-tile-image\">"),
			'Conditional Comments': leaksret("<!--[if true]>\n<link href=\"https://leaking.via/conditional-comment-1\" rel=\"stylesheet\">\n<![endif]-->"),
			Links: leaksret("<link rel=\"stylesheet\" href=\"https://leaking.via/link-stylesheet\" />\n<link rel=\"icon\" href=\"https://leaking.via/link-icon\" />\n<link rel=\"canonical\" href=\"https://leaking.via/link-canonical\" />\n<link rel=\"shortcut icon\" href=\"https://leaking.via/link-shortcut-icon\" />\n<link rel=\"import\" href=\"https://leaking.via/link-import\" />\n<link rel=\"dns-prefetch\" href=\"https://leaking.via/link-dns-prefetch\" />\n<link rel=\"preconnect\" href=\"https://leaking.via/link-preconnect\">\n<link rel=\"prefetch\" href=\"https://leaking.via/link-prefetch\" />\n<link rel=\"preload\" href=\"https://leaking.via/link-preload\" />\n<link rel=\"prerender\" href=\"https://leaking.via/link-prerender\" />\n\n<link rel=\"preload\" as=\"font\" href=\"https://leaking.via/link-preload-as-font\" />\n<link rel=\"preload\" as=\"image\" href=\"https://leaking.via/link-preload-as-image\" />\n<link rel=\"preload\" as=\"image\" imagesrcset=\",,,,,https://leaking.via/link-preload-imagesrcset\" />\n<link rel=\"preload\" as=\"style\" href=\"https://leaking.via/link-preload-as-style\" />\n<link rel=\"preload\" as=\"script\" href=\"https://leaking.via/link-preload-as-script\" />\n\n<link rel=\"search\" href=\"https://leaking.via/link-search\" />\n<!--\nNote that OpenSearch description URLs are ignored in Chrome if this file isn't placed in the webroot.\nAlso, in Chrome, you won't see the request in the developer tools because the request happens in the privileged browser process.\nUse a network sniffer to detect it.\n-->\n\n<link rel=\"alternate\" href=\"https://leaking.via/link-alternate\" />\n<link rel=\"alternate\" type=\"application/atom+xml\" href=\"https://leaking.via/link-alternate-atom\" /> \n<link rel=\"alternate stylesheet\" href=\"https://leaking.via/link-alternate-stylesheet\" />\n<link rel=\"amphtml\" href=\"https://leaking.via/link-amphtml\">\n<link rel=\"appendix\" href=\"https://leaking.via/link-appendix\" />\n<link rel=\"apple-touch-icon-precomposed\" href=\"https://leaking.via/link-apple-touch-icon-precomposed\">\n<link rel=\"apple-touch-icon\" href=\"https://leaking.via/link-apple-touch-icon\">\n<link rel=\"apple-touch-startup-image\" href=\"https://leaking.via/link-apple-touch-startup-image\">\n<link rel=\"archives\" href=\"https://leaking.via/link-archives\" />\n<link rel=\"author\" href=\"https://leaking.via/link-author\" />\n<link rel=\"bookmark\" href=\"https://leaking.via/link-bookmark\" />\n<link rel=\"canonical\" href=\"https://leaking.via/link-canonical\">\n<link rel=\"chapter\" href=\"https://leaking.via/link-chapter\" />\n<link rel=\"chrome-webstore-item\" href=\"https://leaking.via/link-chrome-webstore-item\">\n<link rel=\"contents\" href=\"https://leaking.via/link-contents\" />\n<link rel=\"copyright\" href=\"https://leaking.via/link-copyright\" />\n<link rel=\"entry-content\" href=\"https://leaking.via/link-entry-content\" />\n<link rel=\"external\" href=\"https://leaking.via/link-external\" />\n<link rel=\"feedurl\" href=\"https://leaking.via/link-feedurl\" />\n<link rel=\"first\" href=\"https://leaking.via/link-first\" />\n<link rel=\"glossary\" href=\"https://leaking.via/link-glossary\" />\n<link rel=\"help\" href=\"https://leaking.via/link-help\" />\n<link rel=\"index\" href=\"https://leaking.via/link-index\" />\n<link rel=\"last\" href=\"https://leaking.via/link-last\" />\n<link rel=\"manifest\" href=\"https://leaking.via/link-manifest\" />\n<link rel=\"mask-icon\" href=\"https://leaking.via/link-mask-icon\" color=\"red\">\n<link rel=\"next\" href=\"https://leaking.via/link-next\" />\n<link rel=\"offline\" href=\"https://leaking.via/link-offline\" />\n<link rel=\"P3Pv1\" href=\"https://leaking.via/link-P3Pv1\">\n<link rel=\"pingback\" href=\"https://leaking.via/link-pingback\" />\n<link rel=\"prev\" href=\"https://leaking.via/link-prev\" />\n<link rel=\"publisher\" href=\"https://leaking.via/link-publisher\">\n<link rel=\"search\" type=\"application/opensearchdescription+xml\" href=\"https://leaking.via/link-search-2\" title=\"Search\" /> \n<link rel=\"sidebar\" href=\"https://leaking.via/link-sidebar\" />\n<link rel=\"start\" href=\"https://leaking.via/link-start\" />\n<link rel=\"section\" href=\"https://leaking.via/link-section\" />\n<link rel=\"subsection\" href=\"https://leaking.via/link-subsection\" />\n<link rel=\"subresource\" href=\"https://leaking.via/link-subresource\">\n<link rel=\"tag\" href=\"https://leaking.via/link-tag\" />\n<link rel=\"up\" href=\"https://leaking.via/link-up\" />\n</head>"),
			'Body background': leaksret("<body background=\"https://leaking.via/body-background\">"),
			'Links & Maps': leaksret("<a ping=\"https://leaking.via/a-ping\" href=\"#\">You have to click me</a>\n<img src=\"data:;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw\" width=\"150\" height=\"150\" usemap=\"#map\">\n<map name=\"map\">\n  <area ping=\"https://leaking.via/area-ping\" shape=\"rect\" coords=\"0,0,150,150\" href=\"#\">\n</map> \n<!-- \nThe ping attribute allows to send a HTTP request to an external IP or domain, \neven if the link's HREF points somewhere else. The link has to be clicked though \n\nhttps://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-ping\n-->"),
			'Table Background': leaksret("<table background=\"https://leaking.via/table-background\">\n    <tr>\n        <td background=\"https://leaking.via/td-background\"></td>\n    </tr>\n</table>"),
			Images: leaksret("<img src=\"https://leaking.via/img-src\">\n<img dynsrc=\"https://leaking.via/img-dynsrc\">\n<img lowsrc=\"https://leaking.via/img-lowsrc\">\n<img src=\"data:image/svg+xml,<svg%20xmlns='%68ttp:%2f/www.w3.org/2000/svg'%20xmlns:xlink='%68ttp:%2f/www.w3.org/1999/xlink'><image%20xlink:hr%65f='%68ttps:%2f/leaking.via/svg-via-data'></image></svg>\">\n\n<image src=\"https://leaking.via/image-src\">\n<image href=\"https://leaking.via/image-href\">\n\n<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n<image href=\"https://leaking.via/svg-image-href\">\n<image xlink:href=\"https://leaking.via/svg-image-xlink-href\">\n</svg>\n\n<picture>\n    <source srcset=\"https://leaking.via/picture-source-srcset\">\n</picture>\n<picture>\n    <img srcset=\"https://leaking.via/picture-img-srcset\">\n</picture>\n<img srcset=\",,,,,https://leaking.via/img-srcset\">\n\n<img src=\"#\" longdesc=\"https://leaking.via/img-longdesc\">\n<!-- longdesc works on Firefox but requires right-click, \"View Description\" -->"),
			Forms: leaksret("<form action=\"https://leaking.via/form-action\"></form>\n<form id=\"test\"></form><button form=\"test\" formaction=\"https://leaking.via/button-formaction\">CLICKME</button>\n<input type=\"image\" src=\"https://leaking.via/input-src\" name=\"test\" value=\"test\">\n<isindex src=\"https://leaking.via/isindex-src\" type=\"image\">\n<isindex action=\"https://leaking.via/isindex-action\"></isindex>\n<form id=\"test2\"></form><isindex type=\"submit\" formaction=\"https://leaking.via/isindex-formaction\" form=\"test2\"></isindex>"),
			Media: leaksret("<bgsound src=\"https://leaking.via/bgsound-src\"></bgsound>\n<video src=\"https://leaking.via/video-src\">\n  <track kind=\"subtitles\" label=\"English subtitles\" src=\"https://leaking.via/track-src\" srclang=\"en\" default></track>\n</video>\n<video controls>\n  <source src=\"https://leaking.via/video-source-src\" type=\"video/mp4\">\n</video>\n<audio src=\"https://leaking.via/audio-src\"></audio>\n<audio controls>\n  <source src=\"https://leaking.via/audio-source-src\" type=\"video/mp4\">\n</audio>\n<video poster=\"https://leaking.via/video-poster\" src=\"https://leaking.via/video-poster-2\"></video>"),
			'Object & Embed': leaksret("<object data=\"https://leaking.via/object-data\"></object>\n<object type=\"text/x-scriptlet\" data=\"https://leaking.via/object-data-x-scriptlet\"></object>\n<object movie=\"https://leaking.via/object-movie\" type=\"application/x-shockwave-flash\"></object>\n<object movie=\"https://leaking.via/object-movie\">\n    <param name=\"type\" value=\"application/x-shockwave-flash\"></param>\n</object>\n<object codebase=\"https://leaking.via/object-codebase\"></object>\n<embed src=\"https://leaking.via/embed-src\"></embed>\n<embed code=\"https://leaking.via/embed-code\"></embed>\n<object classid=\"clsid:333C7BC4-460F-11D0-BC04-0080C7055A83\">\n    <param name=\"DataURL\" value=\"https://leaking.via/object-param-dataurl\">\n</object>\n<object classid=\"clsid:6BF52A52-394A-11d3-B153-00C04F79FAA6\">\n    <param name=\"URL\" value=\"https://leaking.via/object-param-url\">\n</object>"),
			Portal: leaksret("<portal src=\"https://leaking.via/portal-src\"></portal>"),
			Script: leaksret("<script src=\"https://leaking.via/script-src\"></script>\n<svg><script href=\"https://leaking.via/svg-script-href\"></script></svg>\n<svg><script xlink:href=\"https://leaking.via/svg-script-xlink-href\"></script></svg>\n<script>\n//# sourceMappingURL=https://leaking.via/javascript-source-map\n</script>"),
			Frames: leaksret("<iframe src=\"https://leaking.via/iframe-src\"></iframe>\n<iframe src=\"data:image/svg+xml,<svg%20xmlns='%68ttp:%2f/www.w3.org/2000/svg'%20xmlns:xlink='%68ttp:%2f/www.w3.org/1999/xlink'><image%20xlink:hr%65f='%68ttps:%2f/leaking.via/svg-via-data'></image></svg>\"></iframe>\n<iframe srcdoc=\"<img src=https://leaking.via/iframe-srcdoc-img-src>\"></iframe>\n<frameset>\n    <frame src=\"https://leaking.via/frame-src\"></frame>\n</frameset>\n<iframe src=\"view-source:https://leaking.via/iframe-src-viewsource\"></iframe>\n<iframe src=\"javascript:'&lt;img src=https://leaking.via/iframe-javascript-src&gt;'\"></iframe>\n<iframe src=\"javascript:'&lt;iframe src=&quot;javascript:\\&apos;&lt;img src=https://leaking.via/iframe-javascript-src-2&gt;\\&apos;&quot;&gt;&lt;/iframe&gt;'\"></iframe>\n<iframe src=\"javascript:atob('PGltZyBzcmM9Imh0dHBzOi8vbGVha2luZy52aWEvaWZyYW1lLWphdmFzY3JpcHQtc3JjLTMiPg==')\"></iframe>"),
			Menu: leaksret("<p contextmenu=\"a\">Right Click</p>\n<menu type=\"context\" id=\"a\">\n    <menuitem label=\"a\" icon=\"https://leaking.via/menuitem-icon\"></menuitem>\n</menu>"),
			CSS: leaksret("<style>\n    /*# sourceMappingURL=https://leaking.via/css-source-map */\n</style>\n<style>\n    @import 'https://leaking.via/css-import-string';\n    @import url(https://leaking.via/css-import-url);\n</style>\n<style>\n    a:after {content: url(https://leaking.via/css-after-content)}\n    a::after {content: url(https://leaking.via/css-after-content-2)}\n    a:before {content: url(https://leaking.via/css-before-content)}\n    a::before {content: url(https://leaking.via/css-before-content-2)}    \n</style>\n<a href=\"#\">ABC</a>\n<style>\n    big {\n        list-style: url(https://leaking.via/css-list-style);\n        list-style-image: url(https://leaking.via/css-list-style-image);\n        background: url(https://leaking.via/css-background);\n        background-image: url(https://leaking.via/css-background-image);\n        border-image: url(https://leaking.via/css-border-image);\n        -moz-border-image: url(https://leaking.via/css--moz-border-image-alias);\n        -webkit-border-image: url(https://leaking.via/css--webkit-border-image-alias);\n        border-image-source: url(https://leaking.via/css-border-image-source);\n        shape-outside: url(https://leaking.via/css-shape-outside);\n        -webkit-shape-outside: url(https://leaking.via/css--webkit-shape-outside-alias);\n        -webkit-mask-image: url(https://leaking.via/css--webkit-mask-image);\n        -webkit-mask-box-image: url(https://leaking.via/css--webkit-mask-box-image);\n        -webkit-mask-box-image-source: url(https://leaking.via/css--webkit-mask-box-image-source);\n        cursor: url(https://leaking.via/css-cursor), auto;\n    }\n</style>\n<big>DEF</big>\n<style>\n    /* Basic font-face */\n    @font-face {\n        font-family: leak;\n        src: url(https://leaking.via/css-font-face-src);\n    }\n    \n    /* \n    * Cross-browser font-face\n    * IE6-8 will use the EOT source, modern browsers will use WOFF(2) and fallback to TTF in case of error\n    * More info:\n    * http://www.paulirish.com/2009/bulletproof-font-face-implementation-syntax/\n    * http://caniuse.com/#search=eot\n    * http://caniuse.com/#search=woff2\n    * http://caniuse.com/#search=woff\n    * http://caniuse.com/#search=ttf\n    */\n    @font-face {\n      font-family: 'leak';\n      src: url('https://leaking.via/css-font-face-src-eot') format('eot'), url('https://leaking.via/css-font-face-src-woff') format('woff'), url('https://leaking.via/css-font-face-src-ttf') format('truetype');\n    }\n\n    big {\n        font-family: leak;\n    }\n</style>\n<big>GHI</big>\n<svg>\n    <style>\n        circle {\n            fill: url(https://leaking.via/svg-css-fill#foo);\n            mask: url(https://leaking.via/svg-css-mask#foo);\n            -webkit-mask: url(https://leaking.via/svg-css--webkit-mask#foo);\n            filter: url(https://leaking.via/svg-css-filter#foo);\n            clip-path: url(https://leaking.via/svg-css-clip-path#foo);\n        }\n    </style>\n    <circle r=\"40\"></circle>\n</svg>\n<s foo=\"https://leaking.via/css-attr-notation\">JKL</s>\n<style>\n    s {\n      --leak: url(https://leaking.via/css-variables);\n    }\n    s {\n      background: var(--leak);\n    }\n    s::after {\n      content: attr(foo url);\n    }    \n    s::before {\n      content: attr(notpresent, url(https://leaking.via/css-attr-fallback));\n    }\n</style>\n<style>\n    p#p1 {\n        background-image: \\75 \\72 \\6C (https://leaking.via/css-escape-url-1);\n    }\n    p#p2 {\n        background-image: \\000075\\000072\\00006C(https://leaking.via/css-escape-url-2);\n    }\n</style>\n<p id=\"p1\">bla</p>\n<p id=\"p2\">bla</p>"),
			'Inline CSS': leaksret("<b style=\"\n        list-style: url(https://leaking.via/inline-css-list-style);\n        list-style-image: url&#40;https://leaking.via/inline-css-list-style-image&#41;;\n        background: url&#x28;https://leaking.via/inline-css-background&#x29;;\n        background-image: url&lpar;https://leaking.via/inline-css-background-image&rpar;;\n        border-image: url(https://leaking.via/inline-css-list-style-image);\n        -moz-border-image: url(https://leaking.via/inline-css--moz-background-image-alias);\n        -webkit-border-image: url(https://leaking.via/inline-css--webkit-background-image-alias);\n        border-image-source: url(https://leaking.via/inline-css-border-image-source);\n        shape-outside: url(https://leaking.via/inline-css-shape-outside);\n        -webkit-shape-outside: url(https://leaking.via/inline-css--webkit-shape-outside-alias);\n        -webkit-mask-image: url(https://leaking.via/inline-css--webkit-mask-image);\n        -webkit-mask-box-image: url(https://leaking.via/inline-css--webkit-mask-box-image);\n        -webkit-mask-box-image-source: url(https://leaking.via/inline-css--webkit-mask-box-image-source);\n        cursor: url(https://leaking.via/inline-css-cursor), auto;\n\">MNO</b>\n\n<svg>\n<circle style=\"\n        fill: url(https://leaking.via/svg-inline-css-fill#foo);\n        mask: url(https://leaking.via/svg-inline-css-mask#foo);\n        -webkit-mask: url(https://leaking.via/svg-inline-css--webkit-mask#foo);\n        filter: url(https://leaking.via/svg-inline-css-filter#foo);\n        clip-path: url(https://leaking.via/svg-inline-css-clip-path#foo);\n\"></circle>\n</svg>"),
			'Exotic Inline CSS': leaksret("<div style=\"background: url() url() url() url() url(https://leaking.via/inline-css-multiple-backgrounds);\"></div>\n<div style=\"behavior: url('https://leaking.via/inline-css-behavior');\"></div>\n<div style=\"-ms-behavior: url('https://leaking.via/inline-css-behavior-2');\"></div>\n<div style=\"background-image: image('https://leaking.via/inline-css-image-function')\"></div>\n<div style=\"filter:progid:DXImageTransform.Microsoft.AlphaImageLoader( src='https://leaking.via/inline-css-filter-alpha', sizingMethod='scale');\" ></div>\n<div style=\"filter:progid:DXImageTransform.Microsoft.ICMFilter(colorSpace='https://leaking.via/inline-css-filter-icm')\"></div>"),
			Applet: leaksret("<applet code=\"Test\" codebase=\"https://leaking.via/applet-codebase\"></applet>\n<applet code=\"Test\" archive=\"https://leaking.via/applet-archive\"></applet>\n<applet code=\"Test\" object=\"https://leaking.via/applet-object\"></applet>"),
			SVG: leaksret("<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n  <defs>\n    <linearGradient id=\"Gradient\">\n      <stop offset=\"0\" stop-color=\"white\" stop-opacity=\"0\" />\n      <stop offset=\"1\" stop-color=\"white\" stop-opacity=\"1\" />\n    </linearGradient>\n    <mask id=\"Mask\">\n      <rect x=\"0\" y=\"0\" width=\"200\" height=\"200\" fill=\"url(https://leaking.via/svg-fill)\"  />\n    </mask>\n  </defs>\n  <rect x=\"0\" y=\"0\" width=\"200\" height=\"200\" fill=\"green\" />\n  <rect x=\"0\" y=\"0\" width=\"200\" height=\"200\" fill=\"red\" mask=\"url(https://leaking.via/svg-mask)\" />\n</svg>\n\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n    <image xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n        <set attributeName=\"xlink:href\" begin=\"0s\" to=\"https://leaking.via/svg-image-set\" />\n    </image>\n</svg>\n\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n    <image xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n        <animate attributeName=\"xlink:href\" begin=\"0s\" from=\"#\" to=\"https://leaking.via/svg-image-animate\" />\n    </image>\n</svg>\n\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n    <feImage xlink:href=\"https://leaking.via/svg-feimage\" />\n</svg>\n\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n    <a xlink:href=\"https://leaking.via/svg-a-text/\"><text transform=\"translate(0,20)\">CLICKME</text></a>\n</svg>\n\n<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\">\n    <rect cursor=\"url(https://leaking.via/svg-cursor),auto\" />\n</svg>\n\n<svg>\n    <font-face-uri xlink:href=\"https://leaking.via/svg-font-face-uri\" />\n</svg>"),
			'XSLT Stylesheets': leaksret("<?xml-stylesheet type=\"text/xsl\" href=\"https://leaking.via/xslt-stylesheet\" ?>"),
			'Data Islands': leaksret("<xml src=\"https://leaking.via/xml-src\" id=\"xml\"></xml>\n<div datasrc=\"#xml\" datafld=\"$text\" dataformatas=\"html\"></div>\n<script language=\"xml\">\n    <!DOCTYPE html SYSTEM \"https://leaking.via/script-doctype\">\n</script>\n<xml>\n    <!DOCTYPE html SYSTEM \"https://leaking.via/xml-doctype\">\n</xml>"),
			VML: leaksret("<line xmlns=\"urn:schemas-microsoft-com:vml\" style=\"behavior:url(#default#vml)\">\n    <fill style=\"behavior:url(#default#vml)\" src=\"https://leaking.via/vml-line-fill-src\" />\n    <stroke style=\"behavior:url(#default#vml)\" src=\"https://leaking.via/vml-line-stroke-src\" />\n    <imageData style=\"behavior:url(#default#vml)\" src=\"https://leaking.via/vml-line-imgdata-src\" />\n</line>\n\n<vmlframe \n    xmlns=\"urn:schemas-microsoft-com:vml\" \n    style=\"behavior:url(#default#vml);position:absolute;width:100%;height:100%\" \n    src=\"https://leaking.via/vmlframe-src#xss\">\n</vmlframe>\n\n<line xmlns=\"urn:schemas-microsoft-com:vml\" style=\"behavior:url(#default#vml)\">\n    <imageData style=\"behavior:url(#default#vml)\" o:href=\"https://leaking.via/vml-line-imgdata-href\" />\n</line>"),
			MathML: leaksret("<math xlink:href=\"https://leaking.via/mathml-math\">CLICKME</math>\n\n<math><mi xlink:href=\"https://leaking.via/mathml-mi\">CLICKME</mi></math>"),
		},
		list_exit(){
			process.exit();
		},
	},
	_interface = ({
		constructor(entries){
			var readline = require('readline');
			
			this.entries = entries;
			this.entries.list_parent = this.entries;
			this.cursor = 0;
			this.sub_menu = false;
			this.shade = ['░', '▒', '▓', '█'];
			this.footer = {
				key: '\x1b[30m\x1b[47m',
				reset: '\x1b[0m',
			};
			
			this.update();

			readline.emitKeypressEvents(process.stdin);
			if(process.stdin.isTTY)process.stdin.setRawMode(true);

			process.stdin.on('keypress', (str, key) => {
				if(key.name == 'c' && key.ctrl)return process.exit();
				
				switch(key.name){
					case'left':
					case'escape':
						
						if(this.entries.list_exit)this.entries.list_exit();
						
						this.entries = this.entries.list_parent;
						this.update();
						
						break;
					case'r':
						
						if(this.entries.list_init)this.entries.list_init();
						this.update();
						
						break;
					case'up':
						
						this.cursor--;
						
						this.update();
						
						break;
					case'down':
						
						this.cursor++;
						
						this.update();
						
						break;
					case'right':
					case'return':
						
						this.select();
						
						break;
				}
			});
			
			return this;
		},
		write(string){
			return process.stdout.write(string);
		},
		clear(){
			return this.write('\n'.repeat(process.stdout.rows));
		},
		obj_entries(entries){
			return Object.entries(entries).filter(([ label, value ]) => typeof value == 'object' && !label.startsWith('list_'));
		},
		list_update(){
			var entries = this.obj_entries(this.entries);
			
			// normalize value
			if(this.cursor < 0)this.cursor += entries.length 
			if(entries.length)this.cursor %= entries.length;
			
			return 'Select an entry:\n\n' + entries.map(([ label, value ], index) => this.shade[index == this.cursor ? 2 : 0] + ' ' + label).join('\n');
		},
		update(){
			this.clear();
			
			setTimeout(() => this.write([ `\n\n${this.shade[3].repeat(4)} ${this.entries.list_title}\n` ].concat(this.entries.list_update ? this.entries.list_update() : this.list_update(), `\n${this.footer.key} ←${this.footer.reset} Exit    ${this.footer.key} ↑${this.footer.reset} Previous    ${this.footer.key} ↓${this.footer.reset} Next    ${this.footer.key} →${this.footer.reset} Select`).join('\n')), 20);
		},
		select(){
			var vals = this.obj_entries(this.entries);
			
			if(!vals[this.cursor])return;
			
			vals[this.cursor][1].list_parent = this.entries;
			this.entries = vals[this.cursor][1];
			if(!this.entries.list_title)this.entries.list_title = vals[this.cursor][0];
			if(this.entries.list_init)this.entries.list_init();
			this.update();
		},
	}).constructor(entries);