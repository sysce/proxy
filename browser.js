var _rewriter = require('./index.js'),
	rewriter = new _rewriter(inject_config);

rewriter.bundle_ts = inject_bundle_ts;

rewriter.exec_globals();