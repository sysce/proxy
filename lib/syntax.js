var require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

var _tokentype = require("./tokentype.js");

var _state = require("./state.js");

var _parseutil = require("./parseutil.js");

var _whitespace = require("./whitespace.js");

var _scopeflags = require("./scopeflags.js");

const pp = _state.Parser.prototype;

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash ΓÇö
// either with each other or with an init property ΓÇö and in
// strict mode, init properties are also not allowed to be repeated.

// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts ΓÇö that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

pp.checkPropClash = function (prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement") return;
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand)) return;
  let key = prop.key,
      name;
  switch (key.type) {
    case "Identifier":
      name = key.name;break;
    case "Literal":
      name = String(key.value);break;
    default:
      return;
  }
  let kind = prop.kind;

  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) refDestructuringErrors.doubleProto = key.start;
          // Backwards-compat kludge. Can be removed in version 6.0
        } else this.raiseRecoverable(key.start, "Redefinition of __proto__ property");
      }
      propHash.proto = true;
    }
    return;
  }
  name = "$" + name;
  let other = propHash[name];
  if (other) {
    let redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition) this.raiseRecoverable(key.start, "Redefinition of property");
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function(s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

pp.parseExpression = function (noIn, refDestructuringErrors) {
  let startPos = this.start,
      startLoc = this.startLoc;
  let expr = this.parseMaybeAssign(noIn, refDestructuringErrors);
  if (this.type === _tokentype.types.comma) {
    let node = this.startNodeAt(startPos, startLoc);
    node.expressions = [expr];
    while (this.eat(_tokentype.types.comma)) node.expressions.push(this.parseMaybeAssign(noIn, refDestructuringErrors));
    return this.finishNode(node, "SequenceExpression");
  }
  return expr;
};

// Parse an assignment expression. This includes applications of
// operators like `+=`.

pp.parseMaybeAssign = function (noIn, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) return this.parseYield(noIn);
    // The tokenizer will assume an expression is allowed after
    // `yield`, but this isn't that kind of yield
    else this.exprAllowed = false;
  }

  let ownDestructuringErrors = false,
      oldParenAssign = -1,
      oldTrailingComma = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new _parseutil.DestructuringErrors();
    ownDestructuringErrors = true;
  }

  let startPos = this.start,
      startLoc = this.startLoc;
  if (this.type === _tokentype.types.parenL || this.type === _tokentype.types.name) this.potentialArrowAt = this.start;
  let left = this.parseMaybeConditional(noIn, refDestructuringErrors);
  if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
  if (this.type.isAssign) {
    let node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    if (this.type === _tokentype.types.eq) left = this.toAssignable(left, false, refDestructuringErrors);
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.doubleProto = -1;
    }
    if (refDestructuringErrors.shorthandAssign >= left.start) refDestructuringErrors.shorthandAssign = -1; // reset because shorthand default was used correctly
    if (this.type === _tokentype.types.eq) this.checkLValPattern(left);else this.checkLValSimple(left);
    node.left = left;
    this.next();
    node.right = this.parseMaybeAssign(noIn);
    return this.finishNode(node, "AssignmentExpression");
  } else {
    if (ownDestructuringErrors) this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (oldParenAssign > -1) refDestructuringErrors.parenthesizedAssign = oldParenAssign;
  if (oldTrailingComma > -1) refDestructuringErrors.trailingComma = oldTrailingComma;
  return left;
};

// Parse a ternary conditional (`?:`) operator.

pp.parseMaybeConditional = function (noIn, refDestructuringErrors) {
  let startPos = this.start,
      startLoc = this.startLoc;
  let expr = this.parseExprOps(noIn, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) return expr;
  if (this.eat(_tokentype.types.question)) {
    let node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(_tokentype.types.colon);
    node.alternate = this.parseMaybeAssign(noIn);
    return this.finishNode(node, "ConditionalExpression");
  }
  return expr;
};

// Start the precedence parser.

pp.parseExprOps = function (noIn, refDestructuringErrors) {
  let startPos = this.start,
      startLoc = this.startLoc;
  let expr = this.parseMaybeUnary(refDestructuringErrors, false);
  if (this.checkExpressionErrors(refDestructuringErrors)) return expr;
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, noIn);
};

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

pp.parseExprOp = function (left, leftStartPos, leftStartLoc, minPrec, noIn) {
  let prec = this.type.binop;
  if (prec != null && (!noIn || this.type !== _tokentype.types._in)) {
    if (prec > minPrec) {
      let logical = this.type === _tokentype.types.logicalOR || this.type === _tokentype.types.logicalAND;
      let coalesce = this.type === _tokentype.types.coalesce;
      if (coalesce) {
        // Handle the precedence of `tt.coalesce` as equal to the range of logical expressions.
        // In other words, `node.right` shouldn't contain logical expressions in order to check the mixed error.
        prec = _tokentype.types.logicalAND.binop;
      }
      let op = this.value;
      this.next();
      let startPos = this.start,
          startLoc = this.startLoc;
      let right = this.parseExprOp(this.parseMaybeUnary(null, false), startPos, startLoc, prec, noIn);
      let node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
      if (logical && this.type === _tokentype.types.coalesce || coalesce && (this.type === _tokentype.types.logicalOR || this.type === _tokentype.types.logicalAND)) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
    }
  }
  return left;
};

pp.buildBinary = function (startPos, startLoc, left, right, op, logical) {
  let node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression");
};

// Parse unary operators, both prefix and postfix.

pp.parseMaybeUnary = function (refDestructuringErrors, sawUnary) {
  let startPos = this.start,
      startLoc = this.startLoc,
      expr;
  if (this.isContextual("await") && (this.inAsync || !this.inFunction && this.options.allowAwaitOutsideFunction)) {
    expr = this.parseAwait();
    sawUnary = true;
  } else if (this.type.prefix) {
    let node = this.startNode(),
        update = this.type === _tokentype.types.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) this.checkLValSimple(node.argument);else if (this.strict && node.operator === "delete" && node.argument.type === "Identifier") this.raiseRecoverable(node.start, "Deleting local variable in strict mode");else sawUnary = true;
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors);
    if (this.checkExpressionErrors(refDestructuringErrors)) return expr;
    while (this.type.postfix && !this.canInsertSemicolon()) {
      let node = this.startNodeAt(startPos, startLoc);
      node.operator = this.value;
      node.prefix = false;
      node.argument = expr;
      this.checkLValSimple(expr);
      this.next();
      expr = this.finishNode(node, "UpdateExpression");
    }
  }

  if (!sawUnary && this.eat(_tokentype.types.starstar)) return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false), "**", false);else return expr;
};

// Parse call, dot, and `[]`-subscript expressions.

pp.parseExprSubscripts = function (refDestructuringErrors) {
  let startPos = this.start,
      startLoc = this.startLoc;
  let expr = this.parseExprAtom(refDestructuringErrors);
  if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")") return expr;
  let result = this.parseSubscripts(expr, startPos, startLoc);
  if (refDestructuringErrors && result.type === "MemberExpression") {
    if (refDestructuringErrors.parenthesizedAssign >= result.start) refDestructuringErrors.parenthesizedAssign = -1;
    if (refDestructuringErrors.parenthesizedBind >= result.start) refDestructuringErrors.parenthesizedBind = -1;
    if (refDestructuringErrors.trailingComma >= result.start) refDestructuringErrors.trailingComma = -1;
  }
  return result;
};

pp.parseSubscripts = function (base, startPos, startLoc, noCalls) {
  let maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" && this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.potentialArrowAt === base.start;
  let optionalChained = false;

  while (true) {
    let element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained);

    if (element.optional) optionalChained = true;
    if (element === base || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        const chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = element;
        element = this.finishNode(chainNode, "ChainExpression");
      }
      return element;
    }

    base = element;
  }
};

pp.parseSubscript = function (base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained) {
  let optionalSupported = this.options.ecmaVersion >= 11;
  let optional = optionalSupported && this.eat(_tokentype.types.questionDot);
  if (noCalls && optional) this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");

  let computed = this.eat(_tokentype.types.bracketL);
  if (computed || optional && this.type !== _tokentype.types.parenL && this.type !== _tokentype.types.backQuote || this.eat(_tokentype.types.dot)) {
    let node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    node.property = computed ? this.parseExpression() : this.parseIdent(this.options.allowReserved !== "never");
    node.computed = !!computed;
    if (computed) this.expect(_tokentype.types.bracketR);
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(_tokentype.types.parenL)) {
    let refDestructuringErrors = new _parseutil.DestructuringErrors(),
        oldYieldPos = this.yieldPos,
        oldAwaitPos = this.awaitPos,
        oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    let exprList = this.parseExprList(_tokentype.types.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !optional && !this.canInsertSemicolon() && this.eat(_tokentype.types.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0) this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function");
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    let node = this.startNodeAt(startPos, startLoc);
    node.callee = base;
    node.arguments = exprList;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "CallExpression");
  } else if (this.type === _tokentype.types.backQuote) {
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    }
    let node = this.startNodeAt(startPos, startLoc);
    node.tag = base;
    node.quasi = this.parseTemplate({ isTagged: true });
    base = this.finishNode(node, "TaggedTemplateExpression");
  }
  return base;
};

// Parse an atomic expression ΓÇö either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.

pp.parseExprAtom = function (refDestructuringErrors) {
  // If a division operator appears in an expression position, the
  // tokenizer got confused, and we force it to read a regexp instead.
  if (this.type === _tokentype.types.slash) this.readRegexp();

  let node,
      canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
    case _tokentype.types._super:
      if (!this.allowSuper) this.raise(this.start, "'super' keyword outside a method");
      node = this.startNode();
      this.next();
      if (this.type === _tokentype.types.parenL && !this.allowDirectSuper) this.raise(node.start, "super() call outside constructor of a subclass");
      // The `super` keyword can appear at below:
      // SuperProperty:
      //     super [ Expression ]
      //     super . IdentifierName
      // SuperCall:
      //     super ( Arguments )
      if (this.type !== _tokentype.types.dot && this.type !== _tokentype.types.bracketL && this.type !== _tokentype.types.parenL) this.unexpected();
      return this.finishNode(node, "Super");

    case _tokentype.types._this:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "ThisExpression");

    case _tokentype.types.name:
      let startPos = this.start,
          startLoc = this.startLoc,
          containsEsc = this.containsEsc;
      let id = this.parseIdent(false);
      if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(_tokentype.types._function)) return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true);
      if (canBeArrow && !this.canInsertSemicolon()) {
        if (this.eat(_tokentype.types.arrow)) return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false);
        if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === _tokentype.types.name && !containsEsc) {
          id = this.parseIdent(false);
          if (this.canInsertSemicolon() || !this.eat(_tokentype.types.arrow)) this.unexpected();
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true);
        }
      }
      return id;

    case _tokentype.types.regexp:
      let value = this.value;
      node = this.parseLiteral(value.value);
      node.regex = { pattern: value.pattern, flags: value.flags };
      return node;

    case _tokentype.types.num:case _tokentype.types.string:
      return this.parseLiteral(this.value);

    case _tokentype.types._null:case _tokentype.types._true:case _tokentype.types._false:
      node = this.startNode();
      node.value = this.type === _tokentype.types._null ? null : this.type === _tokentype.types._true;
      node.raw = this.type.keyword;
      this.next();
      return this.finishNode(node, "Literal");

    case _tokentype.types.parenL:
      let start = this.start,
          expr = this.parseParenAndDistinguishExpression(canBeArrow);
      if (refDestructuringErrors) {
        if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr)) refDestructuringErrors.parenthesizedAssign = start;
        if (refDestructuringErrors.parenthesizedBind < 0) refDestructuringErrors.parenthesizedBind = start;
      }
      return expr;

    case _tokentype.types.bracketL:
      node = this.startNode();
      this.next();
      node.elements = this.parseExprList(_tokentype.types.bracketR, true, true, refDestructuringErrors);
      return this.finishNode(node, "ArrayExpression");

    case _tokentype.types.braceL:
      return this.parseObj(false, refDestructuringErrors);

    case _tokentype.types._function:
      node = this.startNode();
      this.next();
      return this.parseFunction(node, 0);

    case _tokentype.types._class:
      return this.parseClass(this.startNode(), false);

    case _tokentype.types._new:
      return this.parseNew();

    case _tokentype.types.backQuote:
      return this.parseTemplate();

    case _tokentype.types._import:
      if (this.options.ecmaVersion >= 11) {
        return this.parseExprImport();
      } else {
        return this.unexpected();
      }

    default:
      this.unexpected();
  }
};

pp.parseExprImport = function () {
  const node = this.startNode();

  // Consume `import` as an identifier for `import.meta`.
  // Because `this.parseIdent(true)` doesn't check escape sequences, it needs the check of `this.containsEsc`.
  if (this.containsEsc) this.raiseRecoverable(this.start, "Escape sequence in keyword import");
  const meta = this.parseIdent(true);

  switch (this.type) {
    case _tokentype.types.parenL:
      return this.parseDynamicImport(node);
    case _tokentype.types.dot:
      node.meta = meta;
      return this.parseImportMeta(node);
    default:
      this.unexpected();
  }
};

pp.parseDynamicImport = function (node) {
  this.next(); // skip `(`

  // Parse node.source.
  node.source = this.parseMaybeAssign();

  // Verify ending.
  if (!this.eat(_tokentype.types.parenR)) {
    const errorPos = this.start;
    if (this.eat(_tokentype.types.comma) && this.eat(_tokentype.types.parenR)) {
      this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()");
    } else {
      this.unexpected(errorPos);
    }
  }

  return this.finishNode(node, "ImportExpression");
};

pp.parseImportMeta = function (node) {
  this.next(); // skip `.`

  const containsEsc = this.containsEsc;
  node.property = this.parseIdent(true);

  if (node.property.name !== "meta") this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'");
  if (containsEsc) this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters");
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere) this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module");

  return this.finishNode(node, "MetaProperty");
};

pp.parseLiteral = function (value) {
  let node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110) node.bigint = node.raw.slice(0, -1).replace(/_/g, "");
  this.next();
  return this.finishNode(node, "Literal");
};

pp.parseParenExpression = function () {
  this.expect(_tokentype.types.parenL);
  let val = this.parseExpression();
  this.expect(_tokentype.types.parenR);
  return val;
};

pp.parseParenAndDistinguishExpression = function (canBeArrow) {
  let startPos = this.start,
      startLoc = this.startLoc,
      val,
      allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();

    let innerStartPos = this.start,
        innerStartLoc = this.startLoc;
    let exprList = [],
        first = true,
        lastIsComma = false;
    let refDestructuringErrors = new _parseutil.DestructuringErrors(),
        oldYieldPos = this.yieldPos,
        oldAwaitPos = this.awaitPos,
        spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    // Do not save awaitIdentPos to allow checking awaits nested in parameters
    while (this.type !== _tokentype.types.parenR) {
      first ? first = false : this.expect(_tokentype.types.comma);
      if (allowTrailingComma && this.afterTrailingComma(_tokentype.types.parenR, true)) {
        lastIsComma = true;
        break;
      } else if (this.type === _tokentype.types.ellipsis) {
        spreadStart = this.start;
        exprList.push(this.parseParenItem(this.parseRestBinding()));
        if (this.type === _tokentype.types.comma) this.raise(this.start, "Comma is not permitted after the rest element");
        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
      }
    }
    let innerEndPos = this.start,
        innerEndLoc = this.startLoc;
    this.expect(_tokentype.types.parenR);

    if (canBeArrow && !this.canInsertSemicolon() && this.eat(_tokentype.types.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList);
    }

    if (!exprList.length || lastIsComma) this.unexpected(this.lastTokStart);
    if (spreadStart) this.unexpected(spreadStart);
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }

  if (this.options.preserveParens) {
    let par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression");
  } else {
    return val;
  }
};

pp.parseParenItem = function (item) {
  return item;
};

pp.parseParenArrowList = function (startPos, startLoc, exprList) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList);
};

// New's precedence is slightly tricky. It must allow its argument to
// be a `[]` or dot subscript expression, but not a call ΓÇö at least,
// not without wrapping it in parentheses. Thus, it uses the noCalls
// argument to parseSubscripts to prevent it from consuming the
// argument list.

const empty = [];

pp.parseNew = function () {
  if (this.containsEsc) this.raiseRecoverable(this.start, "Escape sequence in keyword new");
  let node = this.startNode();
  let meta = this.parseIdent(true);
  if (this.options.ecmaVersion >= 6 && this.eat(_tokentype.types.dot)) {
    node.meta = meta;
    let containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target") this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'");
    if (containsEsc) this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters");
    if (!this.inNonArrowFunction) this.raiseRecoverable(node.start, "'new.target' can only be used in functions");
    return this.finishNode(node, "MetaProperty");
  }
  let startPos = this.start,
      startLoc = this.startLoc,
      isImport = this.type === _tokentype.types._import;
  node.callee = this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
  if (isImport && node.callee.type === "ImportExpression") {
    this.raise(startPos, "Cannot use new with import()");
  }
  if (this.eat(_tokentype.types.parenL)) node.arguments = this.parseExprList(_tokentype.types.parenR, this.options.ecmaVersion >= 8, false);else node.arguments = empty;
  return this.finishNode(node, "NewExpression");
};

// Parse template expression.

pp.parseTemplateElement = function ({ isTagged }) {
  let elem = this.startNode();
  if (this.type === _tokentype.types.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value,
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === _tokentype.types.backQuote;
  return this.finishNode(elem, "TemplateElement");
};

pp.parseTemplate = function ({ isTagged = false } = {}) {
  let node = this.startNode();
  this.next();
  node.expressions = [];
  let curElt = this.parseTemplateElement({ isTagged });
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this.type === _tokentype.types.eof) this.raise(this.pos, "Unterminated template literal");
    this.expect(_tokentype.types.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(_tokentype.types.braceR);
    node.quasis.push(curElt = this.parseTemplateElement({ isTagged }));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral");
};

pp.isAsyncProp = function (prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" && (this.type === _tokentype.types.name || this.type === _tokentype.types.num || this.type === _tokentype.types.string || this.type === _tokentype.types.bracketL || this.type.keyword || this.options.ecmaVersion >= 9 && this.type === _tokentype.types.star) && !_whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};

// Parse an object literal or binding pattern.

pp.parseObj = function (isPattern, refDestructuringErrors) {
  let node = this.startNode(),
      first = true,
      propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(_tokentype.types.braceR)) {
    if (!first) {
      this.expect(_tokentype.types.comma);
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(_tokentype.types.braceR)) break;
    } else first = false;

    const prop = this.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) this.checkPropClash(prop, propHash, refDestructuringErrors);
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
};

pp.parseProperty = function (isPattern, refDestructuringErrors) {
  let prop = this.startNode(),
      isGenerator,
      isAsync,
      startPos,
      startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(_tokentype.types.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === _tokentype.types.comma) {
        this.raise(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement");
    }
    // To disallow parenthesized identifier via `this.toAssignable()`.
    if (this.type === _tokentype.types.parenL && refDestructuringErrors) {
      if (refDestructuringErrors.parenthesizedAssign < 0) {
        refDestructuringErrors.parenthesizedAssign = this.start;
      }
      if (refDestructuringErrors.parenthesizedBind < 0) {
        refDestructuringErrors.parenthesizedBind = this.start;
      }
    }
    // Parse argument.
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    // To disallow trailing comma via `this.toAssignable()`.
    if (this.type === _tokentype.types.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    // Finish
    return this.finishNode(prop, "SpreadElement");
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern) isGenerator = this.eat(_tokentype.types.star);
  }
  let containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(_tokentype.types.star);
    this.parsePropertyName(prop, refDestructuringErrors);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property");
};

pp.parsePropertyValue = function (prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === _tokentype.types.colon) this.unexpected();

  if (this.eat(_tokentype.types.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === _tokentype.types.parenL) {
    if (isPattern) this.unexpected();
    prop.kind = "init";
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
  } else if (!isPattern && !containsEsc && this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && this.type !== _tokentype.types.comma && this.type !== _tokentype.types.braceR && this.type !== _tokentype.types.eq) {
    if (isGenerator || isAsync) this.unexpected();
    prop.kind = prop.key.name;
    this.parsePropertyName(prop);
    prop.value = this.parseMethod(false);
    let paramCount = prop.kind === "get" ? 0 : 1;
    if (prop.value.params.length !== paramCount) {
      let start = prop.value.start;
      if (prop.kind === "get") this.raiseRecoverable(start, "getter should have no params");else this.raiseRecoverable(start, "setter should have exactly one param");
    } else {
      if (prop.kind === "set" && prop.value.params[0].type === "RestElement") this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params");
    }
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) this.unexpected();
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos) this.awaitIdentPos = startPos;
    prop.kind = "init";
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else if (this.type === _tokentype.types.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0) refDestructuringErrors.shorthandAssign = this.start;
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else {
      prop.value = this.copyNode(prop.key);
    }
    prop.shorthand = true;
  } else this.unexpected();
};

pp.parsePropertyName = function (prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(_tokentype.types.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(_tokentype.types.bracketR);
      return prop.key;
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === _tokentype.types.num || this.type === _tokentype.types.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
};

// Initialize empty function node.

pp.initFunction = function (node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) node.generator = node.expression = false;
  if (this.options.ecmaVersion >= 8) node.async = false;
};

// Parse object or class method.

pp.parseMethod = function (isGenerator, isAsync, allowDirectSuper) {
  let node = this.startNode(),
      oldYieldPos = this.yieldPos,
      oldAwaitPos = this.awaitPos,
      oldAwaitIdentPos = this.awaitIdentPos;

  this.initFunction(node);
  if (this.options.ecmaVersion >= 6) node.generator = isGenerator;
  if (this.options.ecmaVersion >= 8) node.async = !!isAsync;

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope((0, _scopeflags.functionFlags)(isAsync, node.generator) | _scopeflags.SCOPE_SUPER | (allowDirectSuper ? _scopeflags.SCOPE_DIRECT_SUPER : 0));

  this.expect(_tokentype.types.parenL);
  node.params = this.parseBindingList(_tokentype.types.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression");
};

// Parse arrow function expression with given parameters.

pp.parseArrowExpression = function (node, params, isAsync) {
  let oldYieldPos = this.yieldPos,
      oldAwaitPos = this.awaitPos,
      oldAwaitIdentPos = this.awaitIdentPos;

  this.enterScope((0, _scopeflags.functionFlags)(isAsync, false) | _scopeflags.SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) node.async = !!isAsync;

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;

  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression");
};

// Parse function body and check parameters.

pp.parseFunctionBody = function (node, isArrowFunction, isMethod) {
  let isExpression = isArrowFunction && this.type !== _tokentype.types.braceL;
  let oldStrict = this.strict,
      useStrict = false;

  if (isExpression) {
    node.body = this.parseMaybeAssign();
    node.expression = true;
    this.checkParams(node, false);
  } else {
    let nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      // If this is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      if (useStrict && nonSimple) this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list");
    }
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    let oldLabels = this.labels;
    this.labels = [];
    if (useStrict) this.strict = true;

    // Add the params to varDeclaredNames to ensure that an error is thrown
    // if a let/const declaration in the function clashes with one of the params.
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
    if (this.strict && node.id) this.checkLValSimple(node.id, _scopeflags.BIND_OUTSIDE);
    node.body = this.parseBlock(false, undefined, useStrict && !oldStrict);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();
};

pp.isSimpleParamList = function (params) {
  for (var _iterator = params, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
    var _ref;

    if (_isArray) {
      if (_i >= _iterator.length) break;
      _ref = _iterator[_i++];
    } else {
      _i = _iterator.next();
      if (_i.done) break;
      _ref = _i.value;
    }

    let param = _ref;

    if (param.type !== "Identifier") return false;
  }return true;
};

// Checks function params for various disallowed patterns such as using "eval"
// or "arguments" and duplicate parameters.

pp.checkParams = function (node, allowDuplicates) {
  let nameHash = Object.create(null);
  for (var _iterator2 = node.params, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
    var _ref2;

    if (_isArray2) {
      if (_i2 >= _iterator2.length) break;
      _ref2 = _iterator2[_i2++];
    } else {
      _i2 = _iterator2.next();
      if (_i2.done) break;
      _ref2 = _i2.value;
    }

    let param = _ref2;

    this.checkLValInnerPattern(param, _scopeflags.BIND_VAR, allowDuplicates ? null : nameHash);
  }
};

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).

pp.parseExprList = function (close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  let elts = [],
      first = true;
  while (!this.eat(close)) {
    if (!first) {
      this.expect(_tokentype.types.comma);
      if (allowTrailingComma && this.afterTrailingComma(close)) break;
    } else first = false;

    let elt;
    if (allowEmpty && this.type === _tokentype.types.comma) elt = null;else if (this.type === _tokentype.types.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this.type === _tokentype.types.comma && refDestructuringErrors.trailingComma < 0) refDestructuringErrors.trailingComma = this.start;
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts;
};

pp.checkUnreserved = function ({ start, end, name }) {
  if (this.inGenerator && name === "yield") this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator");
  if (this.inAsync && name === "await") this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function");
  if (this.keywords.test(name)) this.raise(start, `Unexpected keyword '${name}'`);
  if (this.options.ecmaVersion < 6 && this.input.slice(start, end).indexOf("\\") !== -1) return;
  const re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await") this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function");
    this.raiseRecoverable(start, `The keyword '${name}' is reserved`);
  }
};

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.

pp.parseIdent = function (liberal, isBinding) {
  let node = this.startNode();
  if (this.type === _tokentype.types.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;

    // To fix https://github.com/acornjs/acorn/issues/575
    // `class` and `function` keywords push new context into this.context.
    // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
    // If the previous token is a dot, this does not apply because the context-managing code already ignored the keyword
    if ((node.name === "class" || node.name === "function") && (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
  } else {
    this.unexpected();
  }
  this.next(!!liberal);
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos) this.awaitIdentPos = node.start;
  }
  return node;
};

// Parses yield expression inside generator.

pp.parseYield = function (noIn) {
  if (!this.yieldPos) this.yieldPos = this.start;

  let node = this.startNode();
  this.next();
  if (this.type === _tokentype.types.semi || this.canInsertSemicolon() || this.type !== _tokentype.types.star && !this.type.startsExpr) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(_tokentype.types.star);
    node.argument = this.parseMaybeAssign(noIn);
  }
  return this.finishNode(node, "YieldExpression");
};

pp.parseAwait = function () {
  if (!this.awaitPos) this.awaitPos = this.start;

  let node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true);
  return this.finishNode(node, "AwaitExpression");
};
},{"./parseutil.js":8,"./scopeflags.js":11,"./state.js":12,"./tokentype.js":16,"./whitespace.js":19}],2:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.isIdentifierStart = isIdentifierStart;
exports.isIdentifierChar = isIdentifierChar;
// Reserved word lists for various dialects of the language

const reservedWords = exports.reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"

  // And the keywords

};const ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";

const keywords = exports.keywords = {
  5: ecma5AndLessKeywords,
  "5module": ecma5AndLessKeywords + " export import",
  6: ecma5AndLessKeywords + " const class extends export import super"
};

const keywordRelationalOperator = exports.keywordRelationalOperator = /^in(stanceof)?$/;

// ## Character categories

// Big ugly regular expressions that match characters in the
// whitespace, identifier, and identifier-start categories. These
// are only applied when a character is found to actually have a
// code point above 128.
// Generated by `bin/generate-identifier-regex.js`.
let nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u08a0-\u08b4\u08b6-\u08c7\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u09fc\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9ffc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7bf\ua7c2-\ua7ca\ua7f5-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
let nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c04\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d00-\u0d03\u0d3b\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1abf\u1ac0\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1df9\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua8ff-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";

const nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
const nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;

// These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range. They were
// generated by bin/generate-identifier-regex.js

// eslint-disable-next-line comma-spacing
const astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 349, 41, 7, 1, 79, 28, 11, 0, 9, 21, 107, 20, 28, 22, 13, 52, 76, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 230, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 35, 56, 264, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 328, 18, 190, 0, 80, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 689, 63, 129, 74, 6, 0, 67, 12, 65, 1, 2, 0, 29, 6135, 9, 1237, 43, 8, 8952, 286, 50, 2, 18, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 2357, 44, 11, 6, 17, 0, 370, 43, 1301, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42717, 35, 4148, 12, 221, 3, 5761, 15, 7472, 3104, 541, 1507, 4938];

// eslint-disable-next-line comma-spacing
const astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 370, 1, 154, 10, 176, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 406, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 330, 3, 19306, 9, 135, 4, 60, 6, 26, 9, 1014, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 262, 6, 10, 9, 419, 13, 1495, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];

// This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.
function isInAstralSet(code, set) {
  let pos = 0x10000;
  for (let i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) return false;
    pos += set[i + 1];
    if (pos >= code) return true;
  }
}

// Test whether a given character code starts an identifier.

function isIdentifierStart(code, astral) {
  if (code < 65) return code === 36;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  if (astral === false) return false;
  return isInAstralSet(code, astralIdentifierStartCodes);
}

// Test whether a given character is part of an identifier.

function isIdentifierChar(code, astral) {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  if (astral === false) return false;
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}
},{}],3:[function(require,module,exports){
"use strict";

var _state = require("./state.js");

var _locutil = require("./locutil.js");

const pp = _state.Parser.prototype;

// This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

pp.raise = function (pos, message) {
  let loc = (0, _locutil.getLineInfo)(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  let err = new SyntaxError(message);
  err.pos = pos;err.loc = loc;err.raisedAt = this.pos;
  throw err;
};

pp.raiseRecoverable = pp.raise;

pp.curPosition = function () {
  if (this.options.locations) {
    return new _locutil.Position(this.curLine, this.pos - this.lineStart);
  }
};
},{"./locutil.js":4,"./state.js":12}],4:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.SourceLocation = exports.Position = undefined;
exports.getLineInfo = getLineInfo;

var _whitespace = require("./whitespace.js");

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

class Position {
  constructor(line, col) {
    this.line = line;
    this.column = col;
  }

  offset(n) {
    return new Position(this.line, this.column + n);
  }
}

exports.Position = Position;
class SourceLocation {
  constructor(p, start, end) {
    this.start = start;
    this.end = end;
    if (p.sourceFile !== null) this.source = p.sourceFile;
  }
}

exports.SourceLocation = SourceLocation; // The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

function getLineInfo(input, offset) {
  for (let line = 1, cur = 0;;) {
    _whitespace.lineBreakG.lastIndex = cur;
    let match = _whitespace.lineBreakG.exec(input);
    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return new Position(line, offset - cur);
    }
  }
}
},{"./whitespace.js":19}],5:[function(require,module,exports){
"use strict";

var _tokentype = require("./tokentype.js");

var _state = require("./state.js");

var _util = require("./util.js");

var _scopeflags = require("./scopeflags.js");

const pp = _state.Parser.prototype;

// Convert existing expression atom to assignable pattern
// if possible.

pp.toAssignable = function (node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
      case "Identifier":
        if (this.inAsync && node.name === "await") this.raise(node.start, "Cannot use 'await' as identifier inside an async function");
        break;

      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        break;

      case "ObjectExpression":
        node.type = "ObjectPattern";
        if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true);
        for (var _iterator = node.properties, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
          var _ref;

          if (_isArray) {
            if (_i >= _iterator.length) break;
            _ref = _iterator[_i++];
          } else {
            _i = _iterator.next();
            if (_i.done) break;
            _ref = _i.value;
          }

          let prop = _ref;

          this.toAssignable(prop, isBinding);
          // Early error:
          //   AssignmentRestProperty[Yield, Await] :
          //     `...` DestructuringAssignmentTarget[Yield, Await]
          //
          //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
          if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) {
            this.raise(prop.argument.start, "Unexpected token");
          }
        }
        break;

      case "Property":
        // AssignmentProperty has type === "Property"
        if (node.kind !== "init") this.raise(node.key.start, "Object pattern can't contain getter or setter");
        this.toAssignable(node.value, isBinding);
        break;

      case "ArrayExpression":
        node.type = "ArrayPattern";
        if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true);
        this.toAssignableList(node.elements, isBinding);
        break;

      case "SpreadElement":
        node.type = "RestElement";
        this.toAssignable(node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern") this.raise(node.argument.start, "Rest elements cannot have a default value");
        break;

      case "AssignmentExpression":
        if (node.operator !== "=") this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
        node.type = "AssignmentPattern";
        delete node.operator;
        this.toAssignable(node.left, isBinding);
        break;

      case "ParenthesizedExpression":
        this.toAssignable(node.expression, isBinding, refDestructuringErrors);
        break;

      case "ChainExpression":
        this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side");
        break;

      case "MemberExpression":
        if (!isBinding) break;

      default:
        this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true);
  return node;
};

// Convert list of expression atoms to binding list.

pp.toAssignableList = function (exprList, isBinding) {
  let end = exprList.length;
  for (let i = 0; i < end; i++) {
    let elt = exprList[i];
    if (elt) this.toAssignable(elt, isBinding);
  }
  if (end) {
    let last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier") this.unexpected(last.argument.start);
  }
  return exprList;
};

// Parses spread element.

pp.parseSpread = function (refDestructuringErrors) {
  let node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement");
};

pp.parseRestBinding = function () {
  let node = this.startNode();
  this.next();

  // RestElement inside of a function parameter must be an identifier
  if (this.options.ecmaVersion === 6 && this.type !== _tokentype.types.name) this.unexpected();

  node.argument = this.parseBindingAtom();

  return this.finishNode(node, "RestElement");
};

// Parses lvalue (assignable) atom.

pp.parseBindingAtom = function () {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
      case _tokentype.types.bracketL:
        let node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(_tokentype.types.bracketR, true, true);
        return this.finishNode(node, "ArrayPattern");

      case _tokentype.types.braceL:
        return this.parseObj(true);
    }
  }
  return this.parseIdent();
};

pp.parseBindingList = function (close, allowEmpty, allowTrailingComma) {
  let elts = [],
      first = true;
  while (!this.eat(close)) {
    if (first) first = false;else this.expect(_tokentype.types.comma);
    if (allowEmpty && this.type === _tokentype.types.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      break;
    } else if (this.type === _tokentype.types.ellipsis) {
      let rest = this.parseRestBinding();
      this.parseBindingListItem(rest);
      elts.push(rest);
      if (this.type === _tokentype.types.comma) this.raise(this.start, "Comma is not permitted after the rest element");
      this.expect(close);
      break;
    } else {
      let elem = this.parseMaybeDefault(this.start, this.startLoc);
      this.parseBindingListItem(elem);
      elts.push(elem);
    }
  }
  return elts;
};

pp.parseBindingListItem = function (param) {
  return param;
};

// Parses assignment pattern around given atom if possible.

pp.parseMaybeDefault = function (startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(_tokentype.types.eq)) return left;
  let node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern");
};

// The following three functions all verify that a node is an lvalue ΓÇö
// something that can be bound, or assigned to. In order to do so, they perform
// a variety of checks:
//
// - Check that none of the bound/assigned-to identifiers are reserved words.
// - Record name declarations for bindings in the appropriate scope.
// - Check duplicate argument names, if checkClashes is set.
//
// If a complex binding pattern is encountered (e.g., object and array
// destructuring), the entire pattern is recursively checked.
//
// There are three versions of checkLVal*() appropriate for different
// circumstances:
//
// - checkLValSimple() shall be used if the syntactic construct supports
//   nothing other than identifiers and member expressions. Parenthesized
//   expressions are also correctly handled. This is generally appropriate for
//   constructs for which the spec says
//
//   > It is a Syntax Error if AssignmentTargetType of [the production] is not
//   > simple.
//
//   It is also appropriate for checking if an identifier is valid and not
//   defined elsewhere, like import declarations or function/class identifiers.
//
//   Examples where this is used include:
//     a += ΓÇª;
//     import a from 'ΓÇª';
//   where a is the node to be checked.
//
// - checkLValPattern() shall be used if the syntactic construct supports
//   anything checkLValSimple() supports, as well as object and array
//   destructuring patterns. This is generally appropriate for constructs for
//   which the spec says
//
//   > It is a Syntax Error if [the production] is neither an ObjectLiteral nor
//   > an ArrayLiteral and AssignmentTargetType of [the production] is not
//   > simple.
//
//   Examples where this is used include:
//     (a = ΓÇª);
//     const a = ΓÇª;
//     try { ΓÇª } catch (a) { ΓÇª }
//   where a is the node to be checked.
//
// - checkLValInnerPattern() shall be used if the syntactic construct supports
//   anything checkLValPattern() supports, as well as default assignment
//   patterns, rest elements, and other constructs that may appear within an
//   object or array destructuring pattern.
//
//   As a special case, function parameters also use checkLValInnerPattern(),
//   as they also support defaults and rest constructs.
//
// These functions deliberately support both assignment and binding constructs,
// as the logic for both is exceedingly similar. If the node is the target of
// an assignment, then bindingType should be set to BIND_NONE. Otherwise, it
// should be set to the appropriate BIND_* constant, like BIND_VAR or
// BIND_LEXICAL.
//
// If the function is called with a non-BIND_NONE bindingType, then
// additionally a checkClashes object may be specified to allow checking for
// duplicate argument names. checkClashes is ignored if the provided construct
// is an assignment (i.e., bindingType is BIND_NONE).

pp.checkLValSimple = function (expr, bindingType = _scopeflags.BIND_NONE, checkClashes) {
  const isBind = bindingType !== _scopeflags.BIND_NONE;

  switch (expr.type) {
    case "Identifier":
      if (this.strict && this.reservedWordsStrictBind.test(expr.name)) this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode");
      if (isBind) {
        if (bindingType === _scopeflags.BIND_LEXICAL && expr.name === "let") this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name");
        if (checkClashes) {
          if ((0, _util.has)(checkClashes, expr.name)) this.raiseRecoverable(expr.start, "Argument name clash");
          checkClashes[expr.name] = true;
        }
        if (bindingType !== _scopeflags.BIND_OUTSIDE) this.declareName(expr.name, bindingType, expr.start);
      }
      break;

    case "ChainExpression":
      this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side");
      break;

    case "MemberExpression":
      if (isBind) this.raiseRecoverable(expr.start, "Binding member expression");
      break;

    case "ParenthesizedExpression":
      if (isBind) this.raiseRecoverable(expr.start, "Binding parenthesized expression");
      return this.checkLValSimple(expr.expression, bindingType, checkClashes);

    default:
      this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
};

pp.checkLValPattern = function (expr, bindingType = _scopeflags.BIND_NONE, checkClashes) {
  switch (expr.type) {
    case "ObjectPattern":
      for (var _iterator2 = expr.properties, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
        var _ref2;

        if (_isArray2) {
          if (_i2 >= _iterator2.length) break;
          _ref2 = _iterator2[_i2++];
        } else {
          _i2 = _iterator2.next();
          if (_i2.done) break;
          _ref2 = _i2.value;
        }

        let prop = _ref2;

        this.checkLValInnerPattern(prop, bindingType, checkClashes);
      }
      break;

    case "ArrayPattern":
      for (var _iterator3 = expr.elements, _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _iterator3[Symbol.iterator]();;) {
        var _ref3;

        if (_isArray3) {
          if (_i3 >= _iterator3.length) break;
          _ref3 = _iterator3[_i3++];
        } else {
          _i3 = _iterator3.next();
          if (_i3.done) break;
          _ref3 = _i3.value;
        }

        let elem = _ref3;

        if (elem) this.checkLValInnerPattern(elem, bindingType, checkClashes);
      }
      break;

    default:
      this.checkLValSimple(expr, bindingType, checkClashes);
  }
};

pp.checkLValInnerPattern = function (expr, bindingType = _scopeflags.BIND_NONE, checkClashes) {
  switch (expr.type) {
    case "Property":
      // AssignmentProperty has type === "Property"
      this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
      break;

    case "AssignmentPattern":
      this.checkLValPattern(expr.left, bindingType, checkClashes);
      break;

    case "RestElement":
      this.checkLValPattern(expr.argument, bindingType, checkClashes);
      break;

    default:
      this.checkLValPattern(expr, bindingType, checkClashes);
  }
};
},{"./scopeflags.js":11,"./state.js":12,"./tokentype.js":16,"./util.js":18}],6:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.Node = undefined;

var _state = require("./state.js");

var _locutil = require("./locutil.js");

class Node {
  constructor(parser, pos, loc) {
    this.type = "";
    this.start = pos;
    this.end = 0;
    if (parser.options.locations) this.loc = new _locutil.SourceLocation(parser, loc);
    if (parser.options.directSourceFile) this.sourceFile = parser.options.directSourceFile;
    if (parser.options.ranges) this.range = [pos, 0];
  }
}

exports.Node = Node; // Start an AST node, attaching a start offset.

const pp = _state.Parser.prototype;

pp.startNode = function () {
  return new Node(this, this.start, this.startLoc);
};

pp.startNodeAt = function (pos, loc) {
  return new Node(this, pos, loc);
};

// Finish an AST node, adding `type` and `end` properties.

function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations) node.loc.end = loc;
  if (this.options.ranges) node.range[1] = pos;
  return node;
}

pp.finishNode = function (node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc);
};

// Finish node at given position

pp.finishNodeAt = function (node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc);
};

pp.copyNode = function (node) {
  let newNode = new Node(this, node.start, this.startLoc);
  for (let prop in node) newNode[prop] = node[prop];
  return newNode;
};
},{"./locutil.js":4,"./state.js":12}],7:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.defaultOptions = undefined;
exports.getOptions = getOptions;

var _util = require("./util.js");

var _locutil = require("./locutil.js");

// A second argument must be given to configure the parser process.
// These options are recognized (only `ecmaVersion` is required):

const defaultOptions = exports.defaultOptions = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (or 2015), 7 (2016), 8 (2017), 9 (2018), 10
  // (2019), 11 (2020), 12 (2021), or `"latest"` (the latest version
  // the library supports). This influences support for strict mode,
  // the set of reserved words, and support for new syntax features.
  ecmaVersion: null,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"` or `"module"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // `onInsertedSemicolon` can be a callback that will be called
  // when a semicolon is automatically inserted. It will be passed
  // the position of the comma as an offset, and if `locations` is
  // enabled, it is given the location as a `{line, column}` object
  // as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program, and an import.meta expression
  // in a script isn't considered an error.
  allowImportExportEverywhere: false,
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: false,
  // When enabled, hashbang directive in the beginning of file
  // is allowed and treated as a line comment.
  allowHashBang: false,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callbackΓÇöthat will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callbackΓÇöthat will corrupt its internal state.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false

  // Interpret and default an options object

};let warnedAboutEcmaVersion = false;

function getOptions(opts) {
  let options = {};

  for (let opt in defaultOptions) options[opt] = opts && (0, _util.has)(opts, opt) ? opts[opt] : defaultOptions[opt];

  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.");
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }

  if (options.allowReserved == null) options.allowReserved = options.ecmaVersion < 5;

  if ((0, _util.isArray)(options.onToken)) {
    let tokens = options.onToken;
    options.onToken = token => tokens.push(token);
  }
  if ((0, _util.isArray)(options.onComment)) options.onComment = pushComment(options, options.onComment);

  return options;
}

function pushComment(options, array) {
  return function (block, text, start, end, startLoc, endLoc) {
    let comment = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end
    };
    if (options.locations) comment.loc = new _locutil.SourceLocation(this, startLoc, endLoc);
    if (options.ranges) comment.range = [start, end];
    array.push(comment);
  };
}
},{"./locutil.js":4,"./util.js":18}],8:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.DestructuringErrors = DestructuringErrors;

var _tokentype = require("./tokentype.js");

var _state = require("./state.js");

var _whitespace = require("./whitespace.js");

const pp = _state.Parser.prototype;

// ## Parser utilities

const literal = /^(?:'((?:\\.|[^'\\])*?)'|"((?:\\.|[^"\\])*?)")/;
pp.strictDirective = function (start) {
  for (;;) {
    // Try to find string literal.
    _whitespace.skipWhiteSpace.lastIndex = start;
    start += _whitespace.skipWhiteSpace.exec(this.input)[0].length;
    let match = literal.exec(this.input.slice(start));
    if (!match) return false;
    if ((match[1] || match[2]) === "use strict") return false;
    start += match[0].length;

    // Skip semicolon, if any.
    _whitespace.skipWhiteSpace.lastIndex = start;
    start += _whitespace.skipWhiteSpace.exec(this.input)[0].length;
    if (this.input[start] === ";") start++;
  }
};

// Predicate that tests whether the next token is of the given
// type, and if yes, consumes it as a side effect.

pp.eat = function (type) {
  if (this.type === type) {
    this.next();
    return true;
  } else {
    return false;
  }
};

// Tests whether parsed token is a contextual keyword.

pp.isContextual = function (name) {
  return this.type === _tokentype.types.name && this.value === name && !this.containsEsc;
};

// Consumes contextual keyword if possible.

pp.eatContextual = function (name) {
  if (!this.isContextual(name)) return false;
  this.next();
  return true;
};

// Asserts that following token is given contextual keyword.

pp.expectContextual = function (name) {
  if (!this.eatContextual(name)) this.unexpected();
};

// Test whether a semicolon can be inserted at the current position.

pp.canInsertSemicolon = function () {
  return this.type === _tokentype.types.eof || this.type === _tokentype.types.braceR || _whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};

pp.insertSemicolon = function () {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon) this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc);
    return true;
  }
};

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

pp.semicolon = function () {
  if (!this.eat(_tokentype.types.semi) && !this.insertSemicolon()) this.unexpected();
};

pp.afterTrailingComma = function (tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma) this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc);
    if (!notNext) this.next();
    return true;
  }
};

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error.

pp.expect = function (type) {
  this.eat(type) || this.unexpected();
};

// Raise an unexpected token error.

pp.unexpected = function (pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};

function DestructuringErrors() {
  this.shorthandAssign = this.trailingComma = this.parenthesizedAssign = this.parenthesizedBind = this.doubleProto = -1;
}

pp.checkPatternErrors = function (refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) return;
  if (refDestructuringErrors.trailingComma > -1) this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element");
  let parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) this.raiseRecoverable(parens, "Parenthesized pattern");
};

pp.checkExpressionErrors = function (refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) return false;
  let shorthandAssign = refDestructuringErrors.shorthandAssign,
      doubleProto = refDestructuringErrors.doubleProto;

  if (!andThrow) return shorthandAssign >= 0 || doubleProto >= 0;
  if (shorthandAssign >= 0) this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns");
  if (doubleProto >= 0) this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property");
};

pp.checkYieldAwaitInDefaultParams = function () {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos)) this.raise(this.yieldPos, "Yield expression cannot be a default value");
  if (this.awaitPos) this.raise(this.awaitPos, "Await expression cannot be a default value");
};

pp.isSimpleAssignTarget = function (expr) {
  if (expr.type === "ParenthesizedExpression") return this.isSimpleAssignTarget(expr.expression);
  return expr.type === "Identifier" || expr.type === "MemberExpression";
};
},{"./state.js":12,"./tokentype.js":16,"./whitespace.js":19}],9:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.RegExpValidationState = undefined;

var _identifier = require("./identifier.js");

var _state = require("./state.js");

var _unicodePropertyData = require("./unicode-property-data.js");

var _unicodePropertyData2 = _interopRequireDefault(_unicodePropertyData);

var _util = require("./util.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const pp = _state.Parser.prototype;

class RegExpValidationState {
  constructor(parser) {
    this.parser = parser;
    this.validFlags = `gim${parser.options.ecmaVersion >= 6 ? "uy" : ""}${parser.options.ecmaVersion >= 9 ? "s" : ""}`;
    this.unicodeProperties = _unicodePropertyData2.default[parser.options.ecmaVersion >= 12 ? 12 : parser.options.ecmaVersion];
    this.source = "";
    this.flags = "";
    this.start = 0;
    this.switchU = false;
    this.switchN = false;
    this.pos = 0;
    this.lastIntValue = 0;
    this.lastStringValue = "";
    this.lastAssertionIsQuantifiable = false;
    this.numCapturingParens = 0;
    this.maxBackReference = 0;
    this.groupNames = [];
    this.backReferenceNames = [];
  }

  reset(start, pattern, flags) {
    const unicode = flags.indexOf("u") !== -1;
    this.start = start | 0;
    this.source = pattern + "";
    this.flags = flags;
    this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
    this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
  }

  raise(message) {
    this.parser.raiseRecoverable(this.start, `Invalid regular expression: /${this.source}/: ${message}`);
  }

  // If u flag is given, this returns the code point at the index (it combines a surrogate pair).
  // Otherwise, this returns the code unit of the index (can be a part of a surrogate pair).
  at(i, forceU = false) {
    const s = this.source;
    const l = s.length;
    if (i >= l) {
      return -1;
    }
    const c = s.charCodeAt(i);
    if (!(forceU || this.switchU) || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l) {
      return c;
    }
    const next = s.charCodeAt(i + 1);
    return next >= 0xDC00 && next <= 0xDFFF ? (c << 10) + next - 0x35FDC00 : c;
  }

  nextIndex(i, forceU = false) {
    const s = this.source;
    const l = s.length;
    if (i >= l) {
      return l;
    }
    let c = s.charCodeAt(i),
        next;
    if (!(forceU || this.switchU) || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l || (next = s.charCodeAt(i + 1)) < 0xDC00 || next > 0xDFFF) {
      return i + 1;
    }
    return i + 2;
  }

  current(forceU = false) {
    return this.at(this.pos, forceU);
  }

  lookahead(forceU = false) {
    return this.at(this.nextIndex(this.pos, forceU), forceU);
  }

  advance(forceU = false) {
    this.pos = this.nextIndex(this.pos, forceU);
  }

  eat(ch, forceU = false) {
    if (this.current(forceU) === ch) {
      this.advance(forceU);
      return true;
    }
    return false;
  }
}

exports.RegExpValidationState = RegExpValidationState;
function codePointToString(ch) {
  if (ch <= 0xFFFF) return String.fromCharCode(ch);
  ch -= 0x10000;
  return String.fromCharCode((ch >> 10) + 0xD800, (ch & 0x03FF) + 0xDC00);
}

/**
 * Validate the flags part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp.validateRegExpFlags = function (state) {
  const validFlags = state.validFlags;
  const flags = state.flags;

  for (let i = 0; i < flags.length; i++) {
    const flag = flags.charAt(i);
    if (validFlags.indexOf(flag) === -1) {
      this.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i + 1) > -1) {
      this.raise(state.start, "Duplicate regular expression flag");
    }
  }
};

/**
 * Validate the pattern part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp.validateRegExpPattern = function (state) {
  this.regexp_pattern(state);

  // The goal symbol for the parse is |Pattern[~U, ~N]|. If the result of
  // parsing contains a |GroupName|, reparse with the goal symbol
  // |Pattern[~U, +N]| and use this result instead. Throw a *SyntaxError*
  // exception if _P_ did not conform to the grammar, if any elements of _P_
  // were not matched by the parse, or if any Early Error conditions exist.
  if (!state.switchN && this.options.ecmaVersion >= 9 && state.groupNames.length > 0) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Pattern
pp.regexp_pattern = function (state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames.length = 0;
  state.backReferenceNames.length = 0;

  this.regexp_disjunction(state);

  if (state.pos !== state.source.length) {
    // Make the same messages as V8.
    if (state.eat(0x29 /* ) */)) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(0x5D /* ] */) || state.eat(0x7D /* } */)) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var _iterator = state.backReferenceNames, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
    var _ref;

    if (_isArray) {
      if (_i >= _iterator.length) break;
      _ref = _iterator[_i++];
    } else {
      _i = _iterator.next();
      if (_i.done) break;
      _ref = _i.value;
    }

    const name = _ref;

    if (state.groupNames.indexOf(name) === -1) {
      state.raise("Invalid named capture referenced");
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Disjunction
pp.regexp_disjunction = function (state) {
  this.regexp_alternative(state);
  while (state.eat(0x7C /* | */)) {
    this.regexp_alternative(state);
  }

  // Make the same message as V8.
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(0x7B /* { */)) {
    state.raise("Lone quantifier brackets");
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Alternative
pp.regexp_alternative = function (state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state));
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Term
pp.regexp_eatTerm = function (state) {
  if (this.regexp_eatAssertion(state)) {
    // Handle `QuantifiableAssertion Quantifier` alternative.
    // `state.lastAssertionIsQuantifiable` is true if the last eaten Assertion
    // is a QuantifiableAssertion.
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      // Make the same message as V8.
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true;
  }

  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true;
  }

  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Assertion
pp.regexp_eatAssertion = function (state) {
  const start = state.pos;
  state.lastAssertionIsQuantifiable = false;

  // ^, $
  if (state.eat(0x5E /* ^ */) || state.eat(0x24 /* $ */)) {
    return true;
  }

  // \b \B
  if (state.eat(0x5C /* \ */)) {
    if (state.eat(0x42 /* B */) || state.eat(0x62 /* b */)) {
      return true;
    }
    state.pos = start;
  }

  // Lookahead / Lookbehind
  if (state.eat(0x28 /* ( */) && state.eat(0x3F /* ? */)) {
    let lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(0x3C /* < */);
    }
    if (state.eat(0x3D /* = */) || state.eat(0x21 /* ! */)) {
      this.regexp_disjunction(state);
      if (!state.eat(0x29 /* ) */)) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true;
    }
  }

  state.pos = start;
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Quantifier
pp.regexp_eatQuantifier = function (state, noError = false) {
  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(0x3F /* ? */);
    return true;
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-QuantifierPrefix
pp.regexp_eatQuantifierPrefix = function (state, noError) {
  return state.eat(0x2A /* * */) || state.eat(0x2B /* + */) || state.eat(0x3F /* ? */) || this.regexp_eatBracedQuantifier(state, noError);
};
pp.regexp_eatBracedQuantifier = function (state, noError) {
  const start = state.pos;
  if (state.eat(0x7B /* { */)) {
    let min = 0,
        max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(0x2C /* , */) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(0x7D /* } */)) {
        // SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-term
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true;
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Atom
pp.regexp_eatAtom = function (state) {
  return this.regexp_eatPatternCharacters(state) || state.eat(0x2E /* . */) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state);
};
pp.regexp_eatReverseSolidusAtomEscape = function (state) {
  const start = state.pos;
  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatAtomEscape(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp.regexp_eatUncapturingGroup = function (state) {
  const start = state.pos;
  if (state.eat(0x28 /* ( */)) {
    if (state.eat(0x3F /* ? */) && state.eat(0x3A /* : */)) {
      this.regexp_disjunction(state);
      if (state.eat(0x29 /* ) */)) {
        return true;
      }
      state.raise("Unterminated group");
    }
    state.pos = start;
  }
  return false;
};
pp.regexp_eatCapturingGroup = function (state) {
  if (state.eat(0x28 /* ( */)) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 0x3F /* ? */) {
        state.raise("Invalid group");
      }
    this.regexp_disjunction(state);
    if (state.eat(0x29 /* ) */)) {
      state.numCapturingParens += 1;
      return true;
    }
    state.raise("Unterminated group");
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedAtom
pp.regexp_eatExtendedAtom = function (state) {
  return state.eat(0x2E /* . */) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state) || this.regexp_eatInvalidBracedQuantifier(state) || this.regexp_eatExtendedPatternCharacter(state);
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-InvalidBracedQuantifier
pp.regexp_eatInvalidBracedQuantifier = function (state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-SyntaxCharacter
pp.regexp_eatSyntaxCharacter = function (state) {
  const ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isSyntaxCharacter(ch) {
  return ch === 0x24 /* $ */ || ch >= 0x28 /* ( */ && ch <= 0x2B /* + */ || ch === 0x2E /* . */ || ch === 0x3F /* ? */ || ch >= 0x5B /* [ */ && ch <= 0x5E /* ^ */ || ch >= 0x7B /* { */ && ch <= 0x7D /* } */
  ;
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-PatternCharacter
// But eat eager.
pp.regexp_eatPatternCharacters = function (state) {
  const start = state.pos;
  let ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedPatternCharacter
pp.regexp_eatExtendedPatternCharacter = function (state) {
  const ch = state.current();
  if (ch !== -1 && ch !== 0x24 /* $ */ && !(ch >= 0x28 /* ( */ && ch <= 0x2B /* + */) && ch !== 0x2E /* . */ && ch !== 0x3F /* ? */ && ch !== 0x5B /* [ */ && ch !== 0x5E /* ^ */ && ch !== 0x7C /* | */
  ) {
      state.advance();
      return true;
    }
  return false;
};

// GroupSpecifier ::
//   [empty]
//   `?` GroupName
pp.regexp_groupSpecifier = function (state) {
  if (state.eat(0x3F /* ? */)) {
    if (this.regexp_eatGroupName(state)) {
      if (state.groupNames.indexOf(state.lastStringValue) !== -1) {
        state.raise("Duplicate capture group name");
      }
      state.groupNames.push(state.lastStringValue);
      return;
    }
    state.raise("Invalid group");
  }
};

// GroupName ::
//   `<` RegExpIdentifierName `>`
// Note: this updates `state.lastStringValue` property with the eaten name.
pp.regexp_eatGroupName = function (state) {
  state.lastStringValue = "";
  if (state.eat(0x3C /* < */)) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(0x3E /* > */)) {
      return true;
    }
    state.raise("Invalid capture group name");
  }
  return false;
};

// RegExpIdentifierName ::
//   RegExpIdentifierStart
//   RegExpIdentifierName RegExpIdentifierPart
// Note: this updates `state.lastStringValue` property with the eaten name.
pp.regexp_eatRegExpIdentifierName = function (state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString(state.lastIntValue);
    }
    return true;
  }
  return false;
};

// RegExpIdentifierStart ::
//   UnicodeIDStart
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[+U]
pp.regexp_eatRegExpIdentifierStart = function (state) {
  const start = state.pos;
  const forceU = this.options.ecmaVersion >= 11;
  let ch = state.current(forceU);
  state.advance(forceU);

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true;
  }

  state.pos = start;
  return false;
};
function isRegExpIdentifierStart(ch) {
  return (0, _identifier.isIdentifierStart)(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F; /* _ */
}

// RegExpIdentifierPart ::
//   UnicodeIDContinue
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[+U]
//   <ZWNJ>
//   <ZWJ>
pp.regexp_eatRegExpIdentifierPart = function (state) {
  const start = state.pos;
  const forceU = this.options.ecmaVersion >= 11;
  let ch = state.current(forceU);
  state.advance(forceU);

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true;
  }

  state.pos = start;
  return false;
};
function isRegExpIdentifierPart(ch) {
  return (0, _identifier.isIdentifierChar)(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */ || ch === 0x200C /* <ZWNJ> */ || ch === 0x200D; /* <ZWJ> */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-AtomEscape
pp.regexp_eatAtomEscape = function (state) {
  if (this.regexp_eatBackReference(state) || this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state) || state.switchN && this.regexp_eatKGroupName(state)) {
    return true;
  }
  if (state.switchU) {
    // Make the same message as V8.
    if (state.current() === 0x63 /* c */) {
        state.raise("Invalid unicode escape");
      }
    state.raise("Invalid escape");
  }
  return false;
};
pp.regexp_eatBackReference = function (state) {
  const start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    const n = state.lastIntValue;
    if (state.switchU) {
      // For SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-atomescape
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true;
    }
    if (n <= state.numCapturingParens) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp.regexp_eatKGroupName = function (state) {
  if (state.eat(0x6B /* k */)) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true;
    }
    state.raise("Invalid named reference");
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-CharacterEscape
pp.regexp_eatCharacterEscape = function (state) {
  return this.regexp_eatControlEscape(state) || this.regexp_eatCControlLetter(state) || this.regexp_eatZero(state) || this.regexp_eatHexEscapeSequence(state) || this.regexp_eatRegExpUnicodeEscapeSequence(state, false) || !state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state) || this.regexp_eatIdentityEscape(state);
};
pp.regexp_eatCControlLetter = function (state) {
  const start = state.pos;
  if (state.eat(0x63 /* c */)) {
    if (this.regexp_eatControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp.regexp_eatZero = function (state) {
  if (state.current() === 0x30 /* 0 */ && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true;
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlEscape
pp.regexp_eatControlEscape = function (state) {
  const ch = state.current();
  if (ch === 0x74 /* t */) {
      state.lastIntValue = 0x09; /* \t */
      state.advance();
      return true;
    }
  if (ch === 0x6E /* n */) {
      state.lastIntValue = 0x0A; /* \n */
      state.advance();
      return true;
    }
  if (ch === 0x76 /* v */) {
      state.lastIntValue = 0x0B; /* \v */
      state.advance();
      return true;
    }
  if (ch === 0x66 /* f */) {
      state.lastIntValue = 0x0C; /* \f */
      state.advance();
      return true;
    }
  if (ch === 0x72 /* r */) {
      state.lastIntValue = 0x0D; /* \r */
      state.advance();
      return true;
    }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlLetter
pp.regexp_eatControlLetter = function (state) {
  const ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 0x20;
    state.advance();
    return true;
  }
  return false;
};
function isControlLetter(ch) {
  return ch >= 0x41 /* A */ && ch <= 0x5A /* Z */ || ch >= 0x61 /* a */ && ch <= 0x7A /* z */;
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-RegExpUnicodeEscapeSequence
pp.regexp_eatRegExpUnicodeEscapeSequence = function (state, forceU = false) {
  const start = state.pos;
  const switchU = forceU || state.switchU;

  if (state.eat(0x75 /* u */)) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      const lead = state.lastIntValue;
      if (switchU && lead >= 0xD800 && lead <= 0xDBFF) {
        const leadSurrogateEnd = state.pos;
        if (state.eat(0x5C /* \ */) && state.eat(0x75 /* u */) && this.regexp_eatFixedHexDigits(state, 4)) {
          const trail = state.lastIntValue;
          if (trail >= 0xDC00 && trail <= 0xDFFF) {
            state.lastIntValue = (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
            return true;
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true;
    }
    if (switchU && state.eat(0x7B /* { */) && this.regexp_eatHexDigits(state) && state.eat(0x7D /* } */) && isValidUnicode(state.lastIntValue)) {
      return true;
    }
    if (switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }

  return false;
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 0x10FFFF;
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-IdentityEscape
pp.regexp_eatIdentityEscape = function (state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true;
    }
    if (state.eat(0x2F /* / */)) {
      state.lastIntValue = 0x2F; /* / */
      return true;
    }
    return false;
  }

  const ch = state.current();
  if (ch !== 0x63 /* c */ && (!state.switchN || ch !== 0x6B /* k */)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }

  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalEscape
pp.regexp_eatDecimalEscape = function (state) {
  state.lastIntValue = 0;
  let ch = state.current();
  if (ch >= 0x31 /* 1 */ && ch <= 0x39 /* 9 */) {
      do {
        state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
        state.advance();
      } while ((ch = state.current()) >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */);
      return true;
    }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClassEscape
pp.regexp_eatCharacterClassEscape = function (state) {
  const ch = state.current();

  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return true;
  }

  if (state.switchU && this.options.ecmaVersion >= 9 && (ch === 0x50 /* P */ || ch === 0x70 /* p */)) {
    state.lastIntValue = -1;
    state.advance();
    if (state.eat(0x7B /* { */) && this.regexp_eatUnicodePropertyValueExpression(state) && state.eat(0x7D /* } */)) {
      return true;
    }
    state.raise("Invalid property name");
  }

  return false;
};
function isCharacterClassEscape(ch) {
  return ch === 0x64 /* d */ || ch === 0x44 /* D */ || ch === 0x73 /* s */ || ch === 0x53 /* S */ || ch === 0x77 /* w */ || ch === 0x57 /* W */
  ;
}

// UnicodePropertyValueExpression ::
//   UnicodePropertyName `=` UnicodePropertyValue
//   LoneUnicodePropertyNameOrValue
pp.regexp_eatUnicodePropertyValueExpression = function (state) {
  const start = state.pos;

  // UnicodePropertyName `=` UnicodePropertyValue
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(0x3D /* = */)) {
    const name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      const value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return true;
    }
  }
  state.pos = start;

  // LoneUnicodePropertyNameOrValue
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    const nameOrValue = state.lastStringValue;
    this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
    return true;
  }
  return false;
};
pp.regexp_validateUnicodePropertyNameAndValue = function (state, name, value) {
  if (!(0, _util.has)(state.unicodeProperties.nonBinary, name)) state.raise("Invalid property name");
  if (!state.unicodeProperties.nonBinary[name].test(value)) state.raise("Invalid property value");
};
pp.regexp_validateUnicodePropertyNameOrValue = function (state, nameOrValue) {
  if (!state.unicodeProperties.binary.test(nameOrValue)) state.raise("Invalid property name");
};

// UnicodePropertyName ::
//   UnicodePropertyNameCharacters
pp.regexp_eatUnicodePropertyName = function (state) {
  let ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 0x5F; /* _ */
}

// UnicodePropertyValue ::
//   UnicodePropertyValueCharacters
pp.regexp_eatUnicodePropertyValue = function (state) {
  let ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch);
}

// LoneUnicodePropertyNameOrValue ::
//   UnicodePropertyValueCharacters
pp.regexp_eatLoneUnicodePropertyNameOrValue = function (state) {
  return this.regexp_eatUnicodePropertyValue(state);
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClass
pp.regexp_eatCharacterClass = function (state) {
  if (state.eat(0x5B /* [ */)) {
    state.eat(0x5E /* ^ */);
    this.regexp_classRanges(state);
    if (state.eat(0x5D /* ] */)) {
      return true;
    }
    // Unreachable since it threw "unterminated regular expression" error before.
    state.raise("Unterminated character class");
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassRanges
// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRanges
// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRangesNoDash
pp.regexp_classRanges = function (state) {
  while (this.regexp_eatClassAtom(state)) {
    const left = state.lastIntValue;
    if (state.eat(0x2D /* - */) && this.regexp_eatClassAtom(state)) {
      const right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtom
// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtomNoDash
pp.regexp_eatClassAtom = function (state) {
  const start = state.pos;

  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatClassEscape(state)) {
      return true;
    }
    if (state.switchU) {
      // Make the same message as V8.
      const ch = state.current();
      if (ch === 0x63 /* c */ || isOctalDigit(ch)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }

  const ch = state.current();
  if (ch !== 0x5D /* ] */) {
      state.lastIntValue = ch;
      state.advance();
      return true;
    }

  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassEscape
pp.regexp_eatClassEscape = function (state) {
  const start = state.pos;

  if (state.eat(0x62 /* b */)) {
    state.lastIntValue = 0x08; /* <BS> */
    return true;
  }

  if (state.switchU && state.eat(0x2D /* - */)) {
    state.lastIntValue = 0x2D; /* - */
    return true;
  }

  if (!state.switchU && state.eat(0x63 /* c */)) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }

  return this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state);
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassControlLetter
pp.regexp_eatClassControlLetter = function (state) {
  const ch = state.current();
  if (isDecimalDigit(ch) || ch === 0x5F /* _ */) {
      state.lastIntValue = ch % 0x20;
      state.advance();
      return true;
    }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp.regexp_eatHexEscapeSequence = function (state) {
  const start = state.pos;
  if (state.eat(0x78 /* x */)) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true;
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalDigits
pp.regexp_eatDecimalDigits = function (state) {
  const start = state.pos;
  let ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
    state.advance();
  }
  return state.pos !== start;
};
function isDecimalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x39; /* 9 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigits
pp.regexp_eatHexDigits = function (state) {
  const start = state.pos;
  let ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start;
};
function isHexDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */ || ch >= 0x41 /* A */ && ch <= 0x46 /* F */ || ch >= 0x61 /* a */ && ch <= 0x66 /* f */;
}
function hexToInt(ch) {
  if (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) {
      return 10 + (ch - 0x41 /* A */);
    }
  if (ch >= 0x61 /* a */ && ch <= 0x66 /* f */) {
      return 10 + (ch - 0x61 /* a */);
    }
  return ch - 0x30; /* 0 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-LegacyOctalEscapeSequence
// Allows only 0-377(octal) i.e. 0-255(decimal).
pp.regexp_eatLegacyOctalEscapeSequence = function (state) {
  if (this.regexp_eatOctalDigit(state)) {
    const n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      const n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true;
  }
  return false;
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-OctalDigit
pp.regexp_eatOctalDigit = function (state) {
  const ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 0x30; /* 0 */
    state.advance();
    return true;
  }
  state.lastIntValue = 0;
  return false;
};
function isOctalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x37; /* 7 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-Hex4Digits
// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigit
// And HexDigit HexDigit in https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp.regexp_eatFixedHexDigits = function (state, length) {
  const start = state.pos;
  state.lastIntValue = 0;
  for (let i = 0; i < length; ++i) {
    const ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false;
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true;
};
},{"./identifier.js":2,"./state.js":12,"./unicode-property-data.js":17,"./util.js":18}],10:[function(require,module,exports){
"use strict";

var _state = require("./state.js");

var _scopeflags = require("./scopeflags.js");

const pp = _state.Parser.prototype;

class Scope {
  constructor(flags) {
    this.flags = flags;
    // A list of var-declared names in the current lexical scope
    this.var = [];
    // A list of lexically-declared names in the current lexical scope
    this.lexical = [];
    // A list of lexically-declared FunctionDeclaration names in the current lexical scope
    this.functions = [];
  }
}

// The functions in this module keep track of declared variables in the current scope in order to detect duplicate variable names.

pp.enterScope = function (flags) {
  this.scopeStack.push(new Scope(flags));
};

pp.exitScope = function () {
  this.scopeStack.pop();
};

// The spec says:
// > At the top level of a function, or script, function declarations are
// > treated like var declarations rather than like lexical declarations.
pp.treatFunctionsAsVarInScope = function (scope) {
  return scope.flags & _scopeflags.SCOPE_FUNCTION || !this.inModule && scope.flags & _scopeflags.SCOPE_TOP;
};

pp.declareName = function (name, bindingType, pos) {
  let redeclared = false;
  if (bindingType === _scopeflags.BIND_LEXICAL) {
    const scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && scope.flags & _scopeflags.SCOPE_TOP) delete this.undefinedExports[name];
  } else if (bindingType === _scopeflags.BIND_SIMPLE_CATCH) {
    const scope = this.currentScope();
    scope.lexical.push(name);
  } else if (bindingType === _scopeflags.BIND_FUNCTION) {
    const scope = this.currentScope();
    if (this.treatFunctionsAsVar) redeclared = scope.lexical.indexOf(name) > -1;else redeclared = scope.lexical.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.functions.push(name);
  } else {
    for (let i = this.scopeStack.length - 1; i >= 0; --i) {
      const scope = this.scopeStack[i];
      if (scope.lexical.indexOf(name) > -1 && !(scope.flags & _scopeflags.SCOPE_SIMPLE_CATCH && scope.lexical[0] === name) || !this.treatFunctionsAsVarInScope(scope) && scope.functions.indexOf(name) > -1) {
        redeclared = true;
        break;
      }
      scope.var.push(name);
      if (this.inModule && scope.flags & _scopeflags.SCOPE_TOP) delete this.undefinedExports[name];
      if (scope.flags & _scopeflags.SCOPE_VAR) break;
    }
  }
  if (redeclared) this.raiseRecoverable(pos, `Identifier '${name}' has already been declared`);
};

pp.checkLocalExport = function (id) {
  // scope.functions must be empty as Module code is always strict.
  if (this.scopeStack[0].lexical.indexOf(id.name) === -1 && this.scopeStack[0].var.indexOf(id.name) === -1) {
    this.undefinedExports[id.name] = id;
  }
};

pp.currentScope = function () {
  return this.scopeStack[this.scopeStack.length - 1];
};

pp.currentVarScope = function () {
  for (let i = this.scopeStack.length - 1;; i--) {
    let scope = this.scopeStack[i];
    if (scope.flags & _scopeflags.SCOPE_VAR) return scope;
  }
};

// Could be useful for `this`, `new.target`, `super()`, `super.property`, and `super[property]`.
pp.currentThisScope = function () {
  for (let i = this.scopeStack.length - 1;; i--) {
    let scope = this.scopeStack[i];
    if (scope.flags & _scopeflags.SCOPE_VAR && !(scope.flags & _scopeflags.SCOPE_ARROW)) return scope;
  }
};
},{"./scopeflags.js":11,"./state.js":12}],11:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.functionFlags = functionFlags;
// Each scope gets a bitset that may contain these flags
const SCOPE_TOP = exports.SCOPE_TOP = 1,
      SCOPE_FUNCTION = exports.SCOPE_FUNCTION = 2,
      SCOPE_VAR = exports.SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION,
      SCOPE_ASYNC = exports.SCOPE_ASYNC = 4,
      SCOPE_GENERATOR = exports.SCOPE_GENERATOR = 8,
      SCOPE_ARROW = exports.SCOPE_ARROW = 16,
      SCOPE_SIMPLE_CATCH = exports.SCOPE_SIMPLE_CATCH = 32,
      SCOPE_SUPER = exports.SCOPE_SUPER = 64,
      SCOPE_DIRECT_SUPER = exports.SCOPE_DIRECT_SUPER = 128;

function functionFlags(async, generator) {
    return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}

// Used in checkLVal* and declareName to determine the type of a binding
const BIND_NONE = exports.BIND_NONE = 0,
      // Not a binding
BIND_VAR = exports.BIND_VAR = 1,
      // Var-style binding
BIND_LEXICAL = exports.BIND_LEXICAL = 2,
      // Let- or const-style binding
BIND_FUNCTION = exports.BIND_FUNCTION = 3,
      // Function declaration
BIND_SIMPLE_CATCH = exports.BIND_SIMPLE_CATCH = 4,
      // Simple (identifier pattern) catch binding
BIND_OUTSIDE = exports.BIND_OUTSIDE = 5; // Special case for function names as bound inside the function
},{}],12:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.Parser = undefined;

var _identifier = require("./identifier.js");

var _tokentype = require("./tokentype.js");

var _whitespace = require("./whitespace.js");

var _options = require("./options.js");

var _util = require("./util.js");

var _scopeflags = require("./scopeflags.js");

class Parser {
  constructor(options, input, startPos) {
    this.options = options = (0, _options.getOptions)(options);
    this.sourceFile = options.sourceFile;
    this.keywords = (0, _util.wordsRegexp)(_identifier.keywords[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
    let reserved = "";
    if (options.allowReserved !== true) {
      reserved = _identifier.reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
      if (options.sourceType === "module") reserved += " await";
    }
    this.reservedWords = (0, _util.wordsRegexp)(reserved);
    let reservedStrict = (reserved ? reserved + " " : "") + _identifier.reservedWords.strict;
    this.reservedWordsStrict = (0, _util.wordsRegexp)(reservedStrict);
    this.reservedWordsStrictBind = (0, _util.wordsRegexp)(reservedStrict + " " + _identifier.reservedWords.strictBind);
    this.input = String(input);

    // Used to signal to callers of `readWord1` whether the word
    // contained any escape sequences. This is needed because words with
    // escape sequences must not be interpreted as keywords.
    this.containsEsc = false;

    // Set up token state

    // The current position of the tokenizer in the input.
    if (startPos) {
      this.pos = startPos;
      this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
      this.curLine = this.input.slice(0, this.lineStart).split(_whitespace.lineBreak).length;
    } else {
      this.pos = this.lineStart = 0;
      this.curLine = 1;
    }

    // Properties of the current token:
    // Its type
    this.type = _tokentype.types.eof;
    // For tokens that include more information than their type, the value
    this.value = null;
    // Its start and end offset
    this.start = this.end = this.pos;
    // And, if locations are used, the {line, column} object
    // corresponding to those offsets
    this.startLoc = this.endLoc = this.curPosition();

    // Position information for the previous token
    this.lastTokEndLoc = this.lastTokStartLoc = null;
    this.lastTokStart = this.lastTokEnd = this.pos;

    // The context stack is used to superficially track syntactic
    // context to predict whether a regular expression is allowed in a
    // given position.
    this.context = this.initialContext();
    this.exprAllowed = true;

    // Figure out if it's a module code.
    this.inModule = options.sourceType === "module";
    this.strict = this.inModule || this.strictDirective(this.pos);

    // Used to signify the start of a potential arrow function
    this.potentialArrowAt = -1;

    // Positions to delayed-check that yield/await does not exist in default parameters.
    this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
    // Labels in scope.
    this.labels = [];
    // Thus-far undefined exports.
    this.undefinedExports = Object.create(null);

    // If enabled, skip leading hashbang line.
    if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!") this.skipLineComment(2);

    // Scope tracking for duplicate variable names (see scope.js)
    this.scopeStack = [];
    this.enterScope(_scopeflags.SCOPE_TOP);

    // For RegExp validation
    this.regexpState = null;
  }

  parse() {
    let node = this.options.program || this.startNode();
    this.nextToken();
    return this.parseTopLevel(node);
  }

  get inFunction() {
    return (this.currentVarScope().flags & _scopeflags.SCOPE_FUNCTION) > 0;
  }
  get inGenerator() {
    return (this.currentVarScope().flags & _scopeflags.SCOPE_GENERATOR) > 0;
  }
  get inAsync() {
    return (this.currentVarScope().flags & _scopeflags.SCOPE_ASYNC) > 0;
  }
  get allowSuper() {
    return (this.currentThisScope().flags & _scopeflags.SCOPE_SUPER) > 0;
  }
  get allowDirectSuper() {
    return (this.currentThisScope().flags & _scopeflags.SCOPE_DIRECT_SUPER) > 0;
  }
  get treatFunctionsAsVar() {
    return this.treatFunctionsAsVarInScope(this.currentScope());
  }
  get inNonArrowFunction() {
    return (this.currentThisScope().flags & _scopeflags.SCOPE_FUNCTION) > 0;
  }

  static extend(...plugins) {
    let cls = this;
    for (let i = 0; i < plugins.length; i++) cls = plugins[i](cls);
    return cls;
  }

  static parse(input, options) {
    return new this(options, input).parse();
  }

  static parseExpressionAt(input, pos, options) {
    let parser = new this(options, input, pos);
    parser.nextToken();
    return parser.parseExpression();
  }

  static tokenizer(input, options) {
    return new this(options, input);
  }
}
exports.Parser = Parser;
},{"./identifier.js":2,"./options.js":7,"./scopeflags.js":11,"./tokentype.js":16,"./util.js":18,"./whitespace.js":19}],13:[function(require,module,exports){
"use strict";

var _tokentype = require("./tokentype.js");

var _state = require("./state.js");

var _whitespace = require("./whitespace.js");

var _identifier = require("./identifier.js");

var _util = require("./util.js");

var _parseutil = require("./parseutil.js");

var _scopeflags = require("./scopeflags.js");

const pp = _state.Parser.prototype;

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.

pp.parseTopLevel = function (node) {
  let exports = Object.create(null);
  if (!node.body) node.body = [];
  while (this.type !== _tokentype.types.eof) {
    let stmt = this.parseStatement(null, true, exports);
    node.body.push(stmt);
  }
  if (this.inModule) {
    for (var _iterator = Object.keys(this.undefinedExports), _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref = _i.value;
      }

      let name = _ref;

      this.raiseRecoverable(this.undefinedExports[name].start, `Export '${name}' is not defined`);
    }
  }this.adaptDirectivePrologue(node.body);
  this.next();
  node.sourceType = this.options.sourceType;
  return this.finishNode(node, "Program");
};

const loopLabel = { kind: "loop" },
      switchLabel = { kind: "switch" };

pp.isLet = function (context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) return false;
  _whitespace.skipWhiteSpace.lastIndex = this.pos;
  let skip = _whitespace.skipWhiteSpace.exec(this.input);
  let next = this.pos + skip[0].length,
      nextCh = this.input.charCodeAt(next);
  // For ambiguous cases, determine if a LexicalDeclaration (or only a
  // Statement) is allowed here. If context is not empty then only a Statement
  // is allowed. However, `let [` is an explicit negative lookahead for
  // ExpressionStatement, so special-case it first.
  if (nextCh === 91) return true; // '['
  if (context) return false;

  if (nextCh === 123) return true; // '{'
  if ((0, _identifier.isIdentifierStart)(nextCh, true)) {
    let pos = next + 1;
    while ((0, _identifier.isIdentifierChar)(this.input.charCodeAt(pos), true)) ++pos;
    let ident = this.input.slice(next, pos);
    if (!_identifier.keywordRelationalOperator.test(ident)) return true;
  }
  return false;
};

// check 'async [no LineTerminator here] function'
// - 'async /*foo*/ function' is OK.
// - 'async /*\n*/ function' is invalid.
pp.isAsyncFunction = function () {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async")) return false;

  _whitespace.skipWhiteSpace.lastIndex = this.pos;
  let skip = _whitespace.skipWhiteSpace.exec(this.input);
  let next = this.pos + skip[0].length;
  return !_whitespace.lineBreak.test(this.input.slice(this.pos, next)) && this.input.slice(next, next + 8) === "function" && (next + 8 === this.input.length || !(0, _identifier.isIdentifierChar)(this.input.charAt(next + 8)));
};

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

pp.parseStatement = function (context, topLevel, exports) {
  let starttype = this.type,
      node = this.startNode(),
      kind;

  if (this.isLet(context)) {
    starttype = _tokentype.types._var;
    kind = "let";
  }

  // Most types of statements are recognized by the keyword they
  // start with. Many are trivial to parse, some require a bit of
  // complexity.

  switch (starttype) {
    case _tokentype.types._break:case _tokentype.types._continue:
      return this.parseBreakContinueStatement(node, starttype.keyword);
    case _tokentype.types._debugger:
      return this.parseDebuggerStatement(node);
    case _tokentype.types._do:
      return this.parseDoStatement(node);
    case _tokentype.types._for:
      return this.parseForStatement(node);
    case _tokentype.types._function:
      // Function as sole body of either an if statement or a labeled statement
      // works, but not when it is part of a labeled statement that is the sole
      // body of an if statement.
      if (context && (this.strict || context !== "if" && context !== "label") && this.options.ecmaVersion >= 6) this.unexpected();
      return this.parseFunctionStatement(node, false, !context);
    case _tokentype.types._class:
      if (context) this.unexpected();
      return this.parseClass(node, true);
    case _tokentype.types._if:
      return this.parseIfStatement(node);
    case _tokentype.types._return:
      return this.parseReturnStatement(node);
    case _tokentype.types._switch:
      return this.parseSwitchStatement(node);
    case _tokentype.types._throw:
      return this.parseThrowStatement(node);
    case _tokentype.types._try:
      return this.parseTryStatement(node);
    case _tokentype.types._const:case _tokentype.types._var:
      kind = kind || this.value;
      if (context && kind !== "var") this.unexpected();
      return this.parseVarStatement(node, kind);
    case _tokentype.types._while:
      return this.parseWhileStatement(node);
    case _tokentype.types._with:
      return this.parseWithStatement(node);
    case _tokentype.types.braceL:
      return this.parseBlock(true, node);
    case _tokentype.types.semi:
      return this.parseEmptyStatement(node);
    case _tokentype.types._export:
    case _tokentype.types._import:
      if (this.options.ecmaVersion > 10 && starttype === _tokentype.types._import) {
        _whitespace.skipWhiteSpace.lastIndex = this.pos;
        let skip = _whitespace.skipWhiteSpace.exec(this.input);
        let next = this.pos + skip[0].length,
            nextCh = this.input.charCodeAt(next);
        if (nextCh === 40 || nextCh === 46) // '(' or '.'
          return this.parseExpressionStatement(node, this.parseExpression());
      }

      if (!this.options.allowImportExportEverywhere) {
        if (!topLevel) this.raise(this.start, "'import' and 'export' may only appear at the top level");
        if (!this.inModule) this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'");
      }
      return starttype === _tokentype.types._import ? this.parseImport(node) : this.parseExport(node, exports);

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
    default:
      if (this.isAsyncFunction()) {
        if (context) this.unexpected();
        this.next();
        return this.parseFunctionStatement(node, true, !context);
      }

      let maybeName = this.value,
          expr = this.parseExpression();
      if (starttype === _tokentype.types.name && expr.type === "Identifier" && this.eat(_tokentype.types.colon)) return this.parseLabeledStatement(node, maybeName, expr, context);else return this.parseExpressionStatement(node, expr);
  }
};

pp.parseBreakContinueStatement = function (node, keyword) {
  let isBreak = keyword === "break";
  this.next();
  if (this.eat(_tokentype.types.semi) || this.insertSemicolon()) node.label = null;else if (this.type !== _tokentype.types.name) this.unexpected();else {
    node.label = this.parseIdent();
    this.semicolon();
  }

  // Verify that there is an actual destination to break or
  // continue to.
  let i = 0;
  for (; i < this.labels.length; ++i) {
    let lab = this.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
      if (node.label && isBreak) break;
    }
  }
  if (i === this.labels.length) this.raise(node.start, "Unsyntactic " + keyword);
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
};

pp.parseDebuggerStatement = function (node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement");
};

pp.parseDoStatement = function (node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(_tokentype.types._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6) this.eat(_tokentype.types.semi);else this.semicolon();
  return this.finishNode(node, "DoWhileStatement");
};

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.

pp.parseForStatement = function (node) {
  this.next();
  let awaitAt = this.options.ecmaVersion >= 9 && (this.inAsync || !this.inFunction && this.options.allowAwaitOutsideFunction) && this.eatContextual("await") ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(_tokentype.types.parenL);
  if (this.type === _tokentype.types.semi) {
    if (awaitAt > -1) this.unexpected(awaitAt);
    return this.parseFor(node, null);
  }
  let isLet = this.isLet();
  if (this.type === _tokentype.types._var || this.type === _tokentype.types._const || isLet) {
    let init = this.startNode(),
        kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init, true, kind);
    this.finishNode(init, "VariableDeclaration");
    if ((this.type === _tokentype.types._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) && init.declarations.length === 1) {
      if (this.options.ecmaVersion >= 9) {
        if (this.type === _tokentype.types._in) {
          if (awaitAt > -1) this.unexpected(awaitAt);
        } else node.await = awaitAt > -1;
      }
      return this.parseForIn(node, init);
    }
    if (awaitAt > -1) this.unexpected(awaitAt);
    return this.parseFor(node, init);
  }
  let refDestructuringErrors = new _parseutil.DestructuringErrors();
  let init = this.parseExpression(true, refDestructuringErrors);
  if (this.type === _tokentype.types._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) {
    if (this.options.ecmaVersion >= 9) {
      if (this.type === _tokentype.types._in) {
        if (awaitAt > -1) this.unexpected(awaitAt);
      } else node.await = awaitAt > -1;
    }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLValPattern(init);
    return this.parseForIn(node, init);
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) this.unexpected(awaitAt);
  return this.parseFor(node, init);
};

pp.parseFunctionStatement = function (node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
};

pp.parseIfStatement = function (node) {
  this.next();
  node.test = this.parseParenExpression();
  // allow function declarations in branches, but only in non-strict mode
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(_tokentype.types._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement");
};

pp.parseReturnStatement = function (node) {
  if (!this.inFunction && !this.options.allowReturnOutsideFunction) this.raise(this.start, "'return' outside of function");
  this.next();

  // In `return` (and `break`/`continue`), the keywords with
  // optional arguments, we eagerly look for a semicolon or the
  // possibility to insert one.

  if (this.eat(_tokentype.types.semi) || this.insertSemicolon()) node.argument = null;else {
    node.argument = this.parseExpression();this.semicolon();
  }
  return this.finishNode(node, "ReturnStatement");
};

pp.parseSwitchStatement = function (node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(_tokentype.types.braceL);
  this.labels.push(switchLabel);
  this.enterScope(0);

  // Statements under must be grouped (by label) in SwitchCase
  // nodes. `cur` is used to keep the node that we are currently
  // adding statements to.

  let cur;
  for (let sawDefault = false; this.type !== _tokentype.types.braceR;) {
    if (this.type === _tokentype.types._case || this.type === _tokentype.types._default) {
      let isCase = this.type === _tokentype.types._case;
      if (cur) this.finishNode(cur, "SwitchCase");
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) this.raiseRecoverable(this.lastTokStart, "Multiple default clauses");
        sawDefault = true;
        cur.test = null;
      }
      this.expect(_tokentype.types.colon);
    } else {
      if (!cur) this.unexpected();
      cur.consequent.push(this.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) this.finishNode(cur, "SwitchCase");
  this.next(); // Closing brace
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement");
};

pp.parseThrowStatement = function (node) {
  this.next();
  if (_whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) this.raise(this.lastTokEnd, "Illegal newline after throw");
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement");
};

// Reused empty array added for node fields that are always empty.

const empty = [];

pp.parseTryStatement = function (node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === _tokentype.types._catch) {
    let clause = this.startNode();
    this.next();
    if (this.eat(_tokentype.types.parenL)) {
      clause.param = this.parseBindingAtom();
      let simple = clause.param.type === "Identifier";
      this.enterScope(simple ? _scopeflags.SCOPE_SIMPLE_CATCH : 0);
      this.checkLValPattern(clause.param, simple ? _scopeflags.BIND_SIMPLE_CATCH : _scopeflags.BIND_LEXICAL);
      this.expect(_tokentype.types.parenR);
    } else {
      if (this.options.ecmaVersion < 10) this.unexpected();
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(_tokentype.types._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer) this.raise(node.start, "Missing catch or finally clause");
  return this.finishNode(node, "TryStatement");
};

pp.parseVarStatement = function (node, kind) {
  this.next();
  this.parseVar(node, false, kind);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration");
};

pp.parseWhileStatement = function (node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement");
};

pp.parseWithStatement = function (node) {
  if (this.strict) this.raise(this.start, "'with' in strict mode");
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement");
};

pp.parseEmptyStatement = function (node) {
  this.next();
  return this.finishNode(node, "EmptyStatement");
};

pp.parseLabeledStatement = function (node, maybeName, expr, context) {
  for (var _iterator2 = this.labels, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
    var _ref2;

    if (_isArray2) {
      if (_i2 >= _iterator2.length) break;
      _ref2 = _iterator2[_i2++];
    } else {
      _i2 = _iterator2.next();
      if (_i2.done) break;
      _ref2 = _i2.value;
    }

    let label = _ref2;

    if (label.name === maybeName) this.raise(expr.start, "Label '" + maybeName + "' is already declared");
  }let kind = this.type.isLoop ? "loop" : this.type === _tokentype.types._switch ? "switch" : null;
  for (let i = this.labels.length - 1; i >= 0; i--) {
    let label = this.labels[i];
    if (label.statementStart === node.start) {
      // Update information about previous labels on this node
      label.statementStart = this.start;
      label.kind = kind;
    } else break;
  }
  this.labels.push({ name: maybeName, kind, statementStart: this.start });
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement");
};

pp.parseExpressionStatement = function (node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement");
};

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).

pp.parseBlock = function (createNewLexicalScope = true, node = this.startNode(), exitStrict) {
  node.body = [];
  this.expect(_tokentype.types.braceL);
  if (createNewLexicalScope) this.enterScope(0);
  while (this.type !== _tokentype.types.braceR) {
    let stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  if (exitStrict) this.strict = false;
  this.next();
  if (createNewLexicalScope) this.exitScope();
  return this.finishNode(node, "BlockStatement");
};

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.

pp.parseFor = function (node, init) {
  node.init = init;
  this.expect(_tokentype.types.semi);
  node.test = this.type === _tokentype.types.semi ? null : this.parseExpression();
  this.expect(_tokentype.types.semi);
  node.update = this.type === _tokentype.types.parenR ? null : this.parseExpression();
  this.expect(_tokentype.types.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement");
};

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.

pp.parseForIn = function (node, init) {
  const isForIn = this.type === _tokentype.types._in;
  this.next();

  if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || this.options.ecmaVersion < 8 || this.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
    this.raise(init.start, `${isForIn ? "for-in" : "for-of"} loop variable declaration may not have an initializer`);
  }
  node.left = init;
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(_tokentype.types.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
};

// Parse a list of variable declarations.

pp.parseVar = function (node, isFor, kind) {
  node.declarations = [];
  node.kind = kind;
  for (;;) {
    let decl = this.startNode();
    this.parseVarId(decl, kind);
    if (this.eat(_tokentype.types.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (kind === "const" && !(this.type === _tokentype.types._in || this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
      this.unexpected();
    } else if (decl.id.type !== "Identifier" && !(isFor && (this.type === _tokentype.types._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(_tokentype.types.comma)) break;
  }
  return node;
};

pp.parseVarId = function (decl, kind) {
  decl.id = this.parseBindingAtom();
  this.checkLValPattern(decl.id, kind === "var" ? _scopeflags.BIND_VAR : _scopeflags.BIND_LEXICAL, false);
};

const FUNC_STATEMENT = 1,
      FUNC_HANGING_STATEMENT = 2,
      FUNC_NULLABLE_ID = 4;

// Parse a function declaration or literal (depending on the
// `statement & FUNC_STATEMENT`).

// Remove `allowExpressionBody` for 7.0.0, as it is only called with false
pp.parseFunction = function (node, statement, allowExpressionBody, isAsync) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === _tokentype.types.star && statement & FUNC_HANGING_STATEMENT) this.unexpected();
    node.generator = this.eat(_tokentype.types.star);
  }
  if (this.options.ecmaVersion >= 8) node.async = !!isAsync;

  if (statement & FUNC_STATEMENT) {
    node.id = statement & FUNC_NULLABLE_ID && this.type !== _tokentype.types.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT))
      // If it is a regular function declaration in sloppy mode, then it is
      // subject to Annex B semantics (BIND_FUNCTION). Otherwise, the binding
      // mode depends on properties of the current scope (see
      // treatFunctionsAsVar).
      this.checkLValSimple(node.id, this.strict || node.generator || node.async ? this.treatFunctionsAsVar ? _scopeflags.BIND_VAR : _scopeflags.BIND_LEXICAL : _scopeflags.BIND_FUNCTION);
  }

  let oldYieldPos = this.yieldPos,
      oldAwaitPos = this.awaitPos,
      oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope((0, _scopeflags.functionFlags)(node.async, node.generator));

  if (!(statement & FUNC_STATEMENT)) node.id = this.type === _tokentype.types.name ? this.parseIdent() : null;

  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression");
};

pp.parseFunctionParams = function (node) {
  this.expect(_tokentype.types.parenL);
  node.params = this.parseBindingList(_tokentype.types.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).

pp.parseClass = function (node, isStatement) {
  this.next();

  // ecma-262 14.6 Class Definitions
  // A class definition is always strict mode code.
  const oldStrict = this.strict;
  this.strict = true;

  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  let classBody = this.startNode();
  let hadConstructor = false;
  classBody.body = [];
  this.expect(_tokentype.types.braceL);
  while (this.type !== _tokentype.types.braceR) {
    const element = this.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) this.raise(element.start, "Duplicate constructor in the same class");
        hadConstructor = true;
      }
    }
  }
  this.strict = oldStrict;
  this.next();
  node.body = this.finishNode(classBody, "ClassBody");
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
};

pp.parseClassElement = function (constructorAllowsSuper) {
  if (this.eat(_tokentype.types.semi)) return null;

  let method = this.startNode();
  const tryContextual = (k, noLineBreak = false) => {
    const start = this.start,
          startLoc = this.startLoc;
    if (!this.eatContextual(k)) return false;
    if (this.type !== _tokentype.types.parenL && (!noLineBreak || !this.canInsertSemicolon())) return true;
    if (method.key) this.unexpected();
    method.computed = false;
    method.key = this.startNodeAt(start, startLoc);
    method.key.name = k;
    this.finishNode(method.key, "Identifier");
    return false;
  };

  method.kind = "method";
  method.static = tryContextual("static");
  let isGenerator = this.eat(_tokentype.types.star);
  let isAsync = false;
  if (!isGenerator) {
    if (this.options.ecmaVersion >= 8 && tryContextual("async", true)) {
      isAsync = true;
      isGenerator = this.options.ecmaVersion >= 9 && this.eat(_tokentype.types.star);
    } else if (tryContextual("get")) {
      method.kind = "get";
    } else if (tryContextual("set")) {
      method.kind = "set";
    }
  }
  if (!method.key) this.parsePropertyName(method);
  let key = method.key;

  let allowsDirectSuper = false;
  if (!method.computed && !method.static && (key.type === "Identifier" && key.name === "constructor" || key.type === "Literal" && key.value === "constructor")) {
    if (method.kind !== "method") this.raise(key.start, "Constructor can't have get/set modifier");
    if (isGenerator) this.raise(key.start, "Constructor can't be a generator");
    if (isAsync) this.raise(key.start, "Constructor can't be an async method");
    method.kind = "constructor";
    allowsDirectSuper = constructorAllowsSuper;
  } else if (method.static && key.type === "Identifier" && key.name === "prototype") {
    this.raise(key.start, "Classes may not have a static property named prototype");
  }
  this.parseClassMethod(method, isGenerator, isAsync, allowsDirectSuper);
  if (method.kind === "get" && method.value.params.length !== 0) this.raiseRecoverable(method.value.start, "getter should have no params");
  if (method.kind === "set" && method.value.params.length !== 1) this.raiseRecoverable(method.value.start, "setter should have exactly one param");
  if (method.kind === "set" && method.value.params[0].type === "RestElement") this.raiseRecoverable(method.value.params[0].start, "Setter cannot use rest params");
  return method;
};

pp.parseClassMethod = function (method, isGenerator, isAsync, allowsDirectSuper) {
  method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
  return this.finishNode(method, "MethodDefinition");
};

pp.parseClassId = function (node, isStatement) {
  if (this.type === _tokentype.types.name) {
    node.id = this.parseIdent();
    if (isStatement) this.checkLValSimple(node.id, _scopeflags.BIND_LEXICAL, false);
  } else {
    if (isStatement === true) this.unexpected();
    node.id = null;
  }
};

pp.parseClassSuper = function (node) {
  node.superClass = this.eat(_tokentype.types._extends) ? this.parseExprSubscripts() : null;
};

// Parses module export declaration.

pp.parseExport = function (node, exports) {
  this.next();
  // export * from '...'
  if (this.eat(_tokentype.types.star)) {
    if (this.options.ecmaVersion >= 11) {
      if (this.eatContextual("as")) {
        node.exported = this.parseIdent(true);
        this.checkExport(exports, node.exported.name, this.lastTokStart);
      } else {
        node.exported = null;
      }
    }
    this.expectContextual("from");
    if (this.type !== _tokentype.types.string) this.unexpected();
    node.source = this.parseExprAtom();
    this.semicolon();
    return this.finishNode(node, "ExportAllDeclaration");
  }
  if (this.eat(_tokentype.types._default)) {
    // export default ...
    this.checkExport(exports, "default", this.lastTokStart);
    let isAsync;
    if (this.type === _tokentype.types._function || (isAsync = this.isAsyncFunction())) {
      let fNode = this.startNode();
      this.next();
      if (isAsync) this.next();
      node.declaration = this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
    } else if (this.type === _tokentype.types._class) {
      let cNode = this.startNode();
      node.declaration = this.parseClass(cNode, "nullableID");
    } else {
      node.declaration = this.parseMaybeAssign();
      this.semicolon();
    }
    return this.finishNode(node, "ExportDefaultDeclaration");
  }
  // export var|const|let|function|class ...
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseStatement(null);
    if (node.declaration.type === "VariableDeclaration") this.checkVariableExport(exports, node.declaration.declarations);else this.checkExport(exports, node.declaration.id.name, node.declaration.id.start);
    node.specifiers = [];
    node.source = null;
  } else {
    // export { x, y as z } [from '...']
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports);
    if (this.eatContextual("from")) {
      if (this.type !== _tokentype.types.string) this.unexpected();
      node.source = this.parseExprAtom();
    } else {
      for (var _iterator3 = node.specifiers, _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _iterator3[Symbol.iterator]();;) {
        var _ref3;

        if (_isArray3) {
          if (_i3 >= _iterator3.length) break;
          _ref3 = _iterator3[_i3++];
        } else {
          _i3 = _iterator3.next();
          if (_i3.done) break;
          _ref3 = _i3.value;
        }

        let spec = _ref3;

        // check for keywords used as local names
        this.checkUnreserved(spec.local);
        // check if export is defined
        this.checkLocalExport(spec.local);
      }

      node.source = null;
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration");
};

pp.checkExport = function (exports, name, pos) {
  if (!exports) return;
  if ((0, _util.has)(exports, name)) this.raiseRecoverable(pos, "Duplicate export '" + name + "'");
  exports[name] = true;
};

pp.checkPatternExport = function (exports, pat) {
  let type = pat.type;
  if (type === "Identifier") this.checkExport(exports, pat.name, pat.start);else if (type === "ObjectPattern") {
    for (var _iterator4 = pat.properties, _isArray4 = Array.isArray(_iterator4), _i4 = 0, _iterator4 = _isArray4 ? _iterator4 : _iterator4[Symbol.iterator]();;) {
      var _ref4;

      if (_isArray4) {
        if (_i4 >= _iterator4.length) break;
        _ref4 = _iterator4[_i4++];
      } else {
        _i4 = _iterator4.next();
        if (_i4.done) break;
        _ref4 = _i4.value;
      }

      let prop = _ref4;

      this.checkPatternExport(exports, prop);
    }
  } else if (type === "ArrayPattern") {
    for (var _iterator5 = pat.elements, _isArray5 = Array.isArray(_iterator5), _i5 = 0, _iterator5 = _isArray5 ? _iterator5 : _iterator5[Symbol.iterator]();;) {
      var _ref5;

      if (_isArray5) {
        if (_i5 >= _iterator5.length) break;
        _ref5 = _iterator5[_i5++];
      } else {
        _i5 = _iterator5.next();
        if (_i5.done) break;
        _ref5 = _i5.value;
      }

      let elt = _ref5;

      if (elt) this.checkPatternExport(exports, elt);
    }
  } else if (type === "Property") this.checkPatternExport(exports, pat.value);else if (type === "AssignmentPattern") this.checkPatternExport(exports, pat.left);else if (type === "RestElement") this.checkPatternExport(exports, pat.argument);else if (type === "ParenthesizedExpression") this.checkPatternExport(exports, pat.expression);
};

pp.checkVariableExport = function (exports, decls) {
  if (!exports) return;
  for (var _iterator6 = decls, _isArray6 = Array.isArray(_iterator6), _i6 = 0, _iterator6 = _isArray6 ? _iterator6 : _iterator6[Symbol.iterator]();;) {
    var _ref6;

    if (_isArray6) {
      if (_i6 >= _iterator6.length) break;
      _ref6 = _iterator6[_i6++];
    } else {
      _i6 = _iterator6.next();
      if (_i6.done) break;
      _ref6 = _i6.value;
    }

    let decl = _ref6;

    this.checkPatternExport(exports, decl.id);
  }
};

pp.shouldParseExportStatement = function () {
  return this.type.keyword === "var" || this.type.keyword === "const" || this.type.keyword === "class" || this.type.keyword === "function" || this.isLet() || this.isAsyncFunction();
};

// Parses a comma-separated list of module exports.

pp.parseExportSpecifiers = function (exports) {
  let nodes = [],
      first = true;
  // export { x, y as z } [from '...']
  this.expect(_tokentype.types.braceL);
  while (!this.eat(_tokentype.types.braceR)) {
    if (!first) {
      this.expect(_tokentype.types.comma);
      if (this.afterTrailingComma(_tokentype.types.braceR)) break;
    } else first = false;

    let node = this.startNode();
    node.local = this.parseIdent(true);
    node.exported = this.eatContextual("as") ? this.parseIdent(true) : node.local;
    this.checkExport(exports, node.exported.name, node.exported.start);
    nodes.push(this.finishNode(node, "ExportSpecifier"));
  }
  return nodes;
};

// Parses import declaration.

pp.parseImport = function (node) {
  this.next();
  // import '...'
  if (this.type === _tokentype.types.string) {
    node.specifiers = empty;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === _tokentype.types.string ? this.parseExprAtom() : this.unexpected();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration");
};

// Parses a comma-separated list of module imports.

pp.parseImportSpecifiers = function () {
  let nodes = [],
      first = true;
  if (this.type === _tokentype.types.name) {
    // import defaultObj, { x, y as z } from '...'
    let node = this.startNode();
    node.local = this.parseIdent();
    this.checkLValSimple(node.local, _scopeflags.BIND_LEXICAL);
    nodes.push(this.finishNode(node, "ImportDefaultSpecifier"));
    if (!this.eat(_tokentype.types.comma)) return nodes;
  }
  if (this.type === _tokentype.types.star) {
    let node = this.startNode();
    this.next();
    this.expectContextual("as");
    node.local = this.parseIdent();
    this.checkLValSimple(node.local, _scopeflags.BIND_LEXICAL);
    nodes.push(this.finishNode(node, "ImportNamespaceSpecifier"));
    return nodes;
  }
  this.expect(_tokentype.types.braceL);
  while (!this.eat(_tokentype.types.braceR)) {
    if (!first) {
      this.expect(_tokentype.types.comma);
      if (this.afterTrailingComma(_tokentype.types.braceR)) break;
    } else first = false;

    let node = this.startNode();
    node.imported = this.parseIdent(true);
    if (this.eatContextual("as")) {
      node.local = this.parseIdent();
    } else {
      this.checkUnreserved(node.imported);
      node.local = node.imported;
    }
    this.checkLValSimple(node.local, _scopeflags.BIND_LEXICAL);
    nodes.push(this.finishNode(node, "ImportSpecifier"));
  }
  return nodes;
};

// Set `ExpressionStatement#directive` property for directive prologues.
pp.adaptDirectivePrologue = function (statements) {
  for (let i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
};
pp.isDirectiveCandidate = function (statement) {
  return statement.type === "ExpressionStatement" && statement.expression.type === "Literal" && typeof statement.expression.value === "string" && (
  // Reject parenthesized strings.
  this.input[statement.start] === "\"" || this.input[statement.start] === "'");
};
},{"./identifier.js":2,"./parseutil.js":8,"./scopeflags.js":11,"./state.js":12,"./tokentype.js":16,"./util.js":18,"./whitespace.js":19}],14:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.types = exports.TokContext = undefined;

var _state = require("./state.js");

var _tokentype = require("./tokentype.js");

var _whitespace = require("./whitespace.js");

class TokContext {
  constructor(token, isExpr, preserveSpace, override, generator) {
    this.token = token;
    this.isExpr = !!isExpr;
    this.preserveSpace = !!preserveSpace;
    this.override = override;
    this.generator = !!generator;
  }
}

exports.TokContext = TokContext; // The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design

const types = exports.types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, p => p.tryReadTemplateToken()),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};

const pp = _state.Parser.prototype;

pp.initialContext = function () {
  return [types.b_stat];
};

pp.braceIsBlock = function (prevType) {
  let parent = this.curContext();
  if (parent === types.f_expr || parent === types.f_stat) return true;
  if (prevType === _tokentype.types.colon && (parent === types.b_stat || parent === types.b_expr)) return !parent.isExpr;

  // The check for `tt.name && exprAllowed` detects whether we are
  // after a `yield` or `of` construct. See the `updateContext` for
  // `tt.name`.
  if (prevType === _tokentype.types._return || prevType === _tokentype.types.name && this.exprAllowed) return _whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
  if (prevType === _tokentype.types._else || prevType === _tokentype.types.semi || prevType === _tokentype.types.eof || prevType === _tokentype.types.parenR || prevType === _tokentype.types.arrow) return true;
  if (prevType === _tokentype.types.braceL) return parent === types.b_stat;
  if (prevType === _tokentype.types._var || prevType === _tokentype.types._const || prevType === _tokentype.types.name) return false;
  return !this.exprAllowed;
};

pp.inGeneratorContext = function () {
  for (let i = this.context.length - 1; i >= 1; i--) {
    let context = this.context[i];
    if (context.token === "function") return context.generator;
  }
  return false;
};

pp.updateContext = function (prevType) {
  let update,
      type = this.type;
  if (type.keyword && prevType === _tokentype.types.dot) this.exprAllowed = false;else if (update = type.updateContext) update.call(this, prevType);else this.exprAllowed = type.beforeExpr;
};

// Token-specific context update code

_tokentype.types.parenR.updateContext = _tokentype.types.braceR.updateContext = function () {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return;
  }
  let out = this.context.pop();
  if (out === types.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};

_tokentype.types.braceL.updateContext = function (prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
  this.exprAllowed = true;
};

_tokentype.types.dollarBraceL.updateContext = function () {
  this.context.push(types.b_tmpl);
  this.exprAllowed = true;
};

_tokentype.types.parenL.updateContext = function (prevType) {
  let statementParens = prevType === _tokentype.types._if || prevType === _tokentype.types._for || prevType === _tokentype.types._with || prevType === _tokentype.types._while;
  this.context.push(statementParens ? types.p_stat : types.p_expr);
  this.exprAllowed = true;
};

_tokentype.types.incDec.updateContext = function () {
  // tokExprAllowed stays unchanged
};

_tokentype.types._function.updateContext = _tokentype.types._class.updateContext = function (prevType) {
  if (prevType.beforeExpr && prevType !== _tokentype.types._else && !(prevType === _tokentype.types.semi && this.curContext() !== types.p_stat) && !(prevType === _tokentype.types._return && _whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) && !((prevType === _tokentype.types.colon || prevType === _tokentype.types.braceL) && this.curContext() === types.b_stat)) this.context.push(types.f_expr);else this.context.push(types.f_stat);
  this.exprAllowed = false;
};

_tokentype.types.backQuote.updateContext = function () {
  if (this.curContext() === types.q_tmpl) this.context.pop();else this.context.push(types.q_tmpl);
  this.exprAllowed = false;
};

_tokentype.types.star.updateContext = function (prevType) {
  if (prevType === _tokentype.types._function) {
    let index = this.context.length - 1;
    if (this.context[index] === types.f_expr) this.context[index] = types.f_expr_gen;else this.context[index] = types.f_gen;
  }
  this.exprAllowed = true;
};

_tokentype.types.name.updateContext = function (prevType) {
  let allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== _tokentype.types.dot) {
    if (this.value === "of" && !this.exprAllowed || this.value === "yield" && this.inGeneratorContext()) allowed = true;
  }
  this.exprAllowed = allowed;
};
},{"./state.js":12,"./tokentype.js":16,"./whitespace.js":19}],15:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.Token = undefined;

var _identifier = require("./identifier.js");

var _tokentype = require("./tokentype.js");

var _state = require("./state.js");

var _locutil = require("./locutil.js");

var _regexp = require("./regexp.js");

var _whitespace = require("./whitespace.js");

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

class Token {
  constructor(p) {
    this.type = p.type;
    this.value = p.value;
    this.start = p.start;
    this.end = p.end;
    if (p.options.locations) this.loc = new _locutil.SourceLocation(p, p.startLoc, p.endLoc);
    if (p.options.ranges) this.range = [p.start, p.end];
  }
}

exports.Token = Token; // ## Tokenizer

const pp = _state.Parser.prototype;

// Move to the next token

pp.next = function (ignoreEscapeSequenceInKeyword) {
  if (!ignoreEscapeSequenceInKeyword && this.type.keyword && this.containsEsc) this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword);
  if (this.options.onToken) this.options.onToken(new Token(this));

  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};

pp.getToken = function () {
  this.next();
  return new Token(this);
};

// If we're in an ES6 environment, make parsers iterable
if (typeof Symbol !== "undefined") pp[Symbol.iterator] = function () {
  return {
    next: () => {
      let token = this.getToken();
      return {
        done: token.type === _tokentype.types.eof,
        value: token
      };
    }
  };
};

// Toggle strict mode. Re-reads the next number or string to please
// pedantic tests (`"use strict"; 010;` should fail).

pp.curContext = function () {
  return this.context[this.context.length - 1];
};

// Read a single token, updating the parser object's token-related
// properties.

pp.nextToken = function () {
  let curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) this.skipSpace();

  this.start = this.pos;
  if (this.options.locations) this.startLoc = this.curPosition();
  if (this.pos >= this.input.length) return this.finishToken(_tokentype.types.eof);

  if (curContext.override) return curContext.override(this);else this.readToken(this.fullCharCodeAtPos());
};

pp.readToken = function (code) {
  // Identifier or keyword. '\uXXXX' sequences are allowed in
  // identifiers, so '\' also dispatches to that.
  if ((0, _identifier.isIdentifierStart)(code, this.options.ecmaVersion >= 6) || code === 92 /* '\' */) return this.readWord();

  return this.getTokenFromCode(code);
};

pp.fullCharCodeAtPos = function () {
  let code = this.input.charCodeAt(this.pos);
  if (code <= 0xd7ff || code >= 0xe000) return code;
  let next = this.input.charCodeAt(this.pos + 1);
  return (code << 10) + next - 0x35fdc00;
};

pp.skipBlockComment = function () {
  let startLoc = this.options.onComment && this.curPosition();
  let start = this.pos,
      end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) this.raise(this.pos - 2, "Unterminated comment");
  this.pos = end + 2;
  if (this.options.locations) {
    _whitespace.lineBreakG.lastIndex = start;
    let match;
    while ((match = _whitespace.lineBreakG.exec(this.input)) && match.index < this.pos) {
      ++this.curLine;
      this.lineStart = match.index + match[0].length;
    }
  }
  if (this.options.onComment) this.options.onComment(true, this.input.slice(start + 2, end), start, this.pos, startLoc, this.curPosition());
};

pp.skipLineComment = function (startSkip) {
  let start = this.pos;
  let startLoc = this.options.onComment && this.curPosition();
  let ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !(0, _whitespace.isNewLine)(ch)) {
    ch = this.input.charCodeAt(++this.pos);
  }
  if (this.options.onComment) this.options.onComment(false, this.input.slice(start + startSkip, this.pos), start, this.pos, startLoc, this.curPosition());
};

// Called at the start of the parse and after every token. Skips
// whitespace and comments, and.

pp.skipSpace = function () {
  loop: while (this.pos < this.input.length) {
    let ch = this.input.charCodeAt(this.pos);
    switch (ch) {
      case 32:case 160:
        // ' '
        ++this.pos;
        break;
      case 13:
        if (this.input.charCodeAt(this.pos + 1) === 10) {
          ++this.pos;
        }
      case 10:case 8232:case 8233:
        ++this.pos;
        if (this.options.locations) {
          ++this.curLine;
          this.lineStart = this.pos;
        }
        break;
      case 47:
        // '/'
        switch (this.input.charCodeAt(this.pos + 1)) {
          case 42:
            // '*'
            this.skipBlockComment();
            break;
          case 47:
            this.skipLineComment(2);
            break;
          default:
            break loop;
        }
        break;
      default:
        if (ch > 8 && ch < 14 || ch >= 5760 && _whitespace.nonASCIIwhitespace.test(String.fromCharCode(ch))) {
          ++this.pos;
        } else {
          break loop;
        }
    }
  }
};

// Called at the end of every token. Sets `end`, `val`, and
// maintains `context` and `exprAllowed`, and skips the space after
// the token, so that the next one's `start` will point at the
// right position.

pp.finishToken = function (type, val) {
  this.end = this.pos;
  if (this.options.locations) this.endLoc = this.curPosition();
  let prevType = this.type;
  this.type = type;
  this.value = val;

  this.updateContext(prevType);
};

// ### Token reading

// This is the function that is called to fetch the next token. It
// is somewhat obscure, because it works in character codes rather
// than characters, and because operator parsing has been inlined
// into it.
//
// All in the name of speed.
//
pp.readToken_dot = function () {
  let next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) return this.readNumber(true);
  let next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) {
    // 46 = dot '.'
    this.pos += 3;
    return this.finishToken(_tokentype.types.ellipsis);
  } else {
    ++this.pos;
    return this.finishToken(_tokentype.types.dot);
  }
};

pp.readToken_slash = function () {
  // '/'
  let next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) {
    ++this.pos;return this.readRegexp();
  }
  if (next === 61) return this.finishOp(_tokentype.types.assign, 2);
  return this.finishOp(_tokentype.types.slash, 1);
};

pp.readToken_mult_modulo_exp = function (code) {
  // '%*'
  let next = this.input.charCodeAt(this.pos + 1);
  let size = 1;
  let tokentype = code === 42 ? _tokentype.types.star : _tokentype.types.modulo;

  // exponentiation operator ** and **=
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = _tokentype.types.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }

  if (next === 61) return this.finishOp(_tokentype.types.assign, size + 1);
  return this.finishOp(tokentype, size);
};

pp.readToken_pipe_amp = function (code) {
  // '|&'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      let next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) return this.finishOp(_tokentype.types.assign, 3);
    }
    return this.finishOp(code === 124 ? _tokentype.types.logicalOR : _tokentype.types.logicalAND, 2);
  }
  if (next === 61) return this.finishOp(_tokentype.types.assign, 2);
  return this.finishOp(code === 124 ? _tokentype.types.bitwiseOR : _tokentype.types.bitwiseAND, 1);
};

pp.readToken_caret = function () {
  // '^'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) return this.finishOp(_tokentype.types.assign, 2);
  return this.finishOp(_tokentype.types.bitwiseXOR, 1);
};

pp.readToken_plus_min = function (code) {
  // '+-'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 && (this.lastTokEnd === 0 || _whitespace.lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      // A `-->` line comment
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken();
    }
    return this.finishOp(_tokentype.types.incDec, 2);
  }
  if (next === 61) return this.finishOp(_tokentype.types.assign, 2);
  return this.finishOp(_tokentype.types.plusMin, 1);
};

pp.readToken_lt_gt = function (code) {
  // '<>'
  let next = this.input.charCodeAt(this.pos + 1);
  let size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) return this.finishOp(_tokentype.types.assign, size + 1);
    return this.finishOp(_tokentype.types.bitShift, size);
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 && this.input.charCodeAt(this.pos + 3) === 45) {
    // `<!--`, an XML-style comment that should be interpreted as a line comment
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken();
  }
  if (next === 61) size = 2;
  return this.finishOp(_tokentype.types.relational, size);
};

pp.readToken_eq_excl = function (code) {
  // '=!'
  let next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) return this.finishOp(_tokentype.types.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) {
    // '=>'
    this.pos += 2;
    return this.finishToken(_tokentype.types.arrow);
  }
  return this.finishOp(code === 61 ? _tokentype.types.eq : _tokentype.types.prefix, 1);
};

pp.readToken_question = function () {
  // '?'
  const ecmaVersion = this.options.ecmaVersion;
  if (ecmaVersion >= 11) {
    let next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      let next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) return this.finishOp(_tokentype.types.questionDot, 2);
    }
    if (next === 63) {
      if (ecmaVersion >= 12) {
        let next2 = this.input.charCodeAt(this.pos + 2);
        if (next2 === 61) return this.finishOp(_tokentype.types.assign, 3);
      }
      return this.finishOp(_tokentype.types.coalesce, 2);
    }
  }
  return this.finishOp(_tokentype.types.question, 1);
};

pp.getTokenFromCode = function (code) {
  switch (code) {
    // The interpretation of a dot depends on whether it is followed
    // by a digit or another two dots.
    case 46:
      // '.'
      return this.readToken_dot();

    // Punctuation tokens.
    case 40:
      ++this.pos;return this.finishToken(_tokentype.types.parenL);
    case 41:
      ++this.pos;return this.finishToken(_tokentype.types.parenR);
    case 59:
      ++this.pos;return this.finishToken(_tokentype.types.semi);
    case 44:
      ++this.pos;return this.finishToken(_tokentype.types.comma);
    case 91:
      ++this.pos;return this.finishToken(_tokentype.types.bracketL);
    case 93:
      ++this.pos;return this.finishToken(_tokentype.types.bracketR);
    case 123:
      ++this.pos;return this.finishToken(_tokentype.types.braceL);
    case 125:
      ++this.pos;return this.finishToken(_tokentype.types.braceR);
    case 58:
      ++this.pos;return this.finishToken(_tokentype.types.colon);

    case 96:
      // '`'
      if (this.options.ecmaVersion < 6) break;
      ++this.pos;
      return this.finishToken(_tokentype.types.backQuote);

    case 48:
      // '0'
      let next = this.input.charCodeAt(this.pos + 1);
      if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
      if (this.options.ecmaVersion >= 6) {
        if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number
        if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
      }

    // Anything else beginning with a digit is an integer, octal
    // number, or float.
    case 49:case 50:case 51:case 52:case 53:case 54:case 55:case 56:case 57:
      // 1-9
      return this.readNumber(false);

    // Quotes produce strings.
    case 34:case 39:
      // '"', "'"
      return this.readString(code);

    // Operators are parsed inline in tiny state machines. '=' (61) is
    // often referred to. `finishOp` simply skips the amount of
    // characters it is given as second argument, and returns a token
    // of the type given by its first argument.

    case 47:
      // '/'
      return this.readToken_slash();

    case 37:case 42:
      // '%*'
      return this.readToken_mult_modulo_exp(code);

    case 124:case 38:
      // '|&'
      return this.readToken_pipe_amp(code);

    case 94:
      // '^'
      return this.readToken_caret();

    case 43:case 45:
      // '+-'
      return this.readToken_plus_min(code);

    case 60:case 62:
      // '<>'
      return this.readToken_lt_gt(code);

    case 61:case 33:
      // '=!'
      return this.readToken_eq_excl(code);

    case 63:
      // '?'
      return this.readToken_question();

    case 126:
      // '~'
      return this.finishOp(_tokentype.types.prefix, 1);
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};

pp.finishOp = function (type, size) {
  let str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str);
};

pp.readRegexp = function () {
  let escaped,
      inClass,
      start = this.pos;
  for (;;) {
    if (this.pos >= this.input.length) this.raise(start, "Unterminated regular expression");
    let ch = this.input.charAt(this.pos);
    if (_whitespace.lineBreak.test(ch)) this.raise(start, "Unterminated regular expression");
    if (!escaped) {
      if (ch === "[") inClass = true;else if (ch === "]" && inClass) inClass = false;else if (ch === "/" && !inClass) break;
      escaped = ch === "\\";
    } else escaped = false;
    ++this.pos;
  }
  let pattern = this.input.slice(start, this.pos);
  ++this.pos;
  let flagsStart = this.pos;
  let flags = this.readWord1();
  if (this.containsEsc) this.unexpected(flagsStart);

  // Validate pattern
  const state = this.regexpState || (this.regexpState = new _regexp.RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);

  // Create Literal#value property value.
  let value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {
    // ESTree requires null if it failed to instantiate RegExp object.
    // https://github.com/estree/estree/blob/a27003adf4fd7bfad44de9cef372a2eacd527b1c/es5.md#regexpliteral
  }

  return this.finishToken(_tokentype.types.regexp, { pattern, flags, value });
};

// Read an integer in the given radix. Return null if zero digits
// were read, the integer value otherwise. When `len` is given, this
// will return `null` unless the integer has exactly `len` digits.

pp.readInt = function (radix, len, maybeLegacyOctalNumericLiteral) {
  // `len` is used for character escape sequences. In that case, disallow separators.
  const allowSeparators = this.options.ecmaVersion >= 12 && len === undefined;

  // `maybeLegacyOctalNumericLiteral` is true if it doesn't have prefix (0x,0o,0b)
  // and isn't fraction part nor exponent part. In that case, if the first digit
  // is zero then disallow separators.
  const isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && this.input.charCodeAt(this.pos) === 48;

  let start = this.pos,
      total = 0,
      lastCode = 0;
  for (let i = 0, e = len == null ? Infinity : len; i < e; ++i, ++this.pos) {
    let code = this.input.charCodeAt(this.pos),
        val;

    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals");
      if (lastCode === 95) this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore");
      if (i === 0) this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits");
      lastCode = code;
      continue;
    }

    if (code >= 97) val = code - 97 + 10; // a
    else if (code >= 65) val = code - 65 + 10; // A
      else if (code >= 48 && code <= 57) val = code - 48; // 0-9
        else val = Infinity;
    if (val >= radix) break;
    lastCode = code;
    total = total * radix + val;
  }

  if (allowSeparators && lastCode === 95) this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits");
  if (this.pos === start || len != null && this.pos - start !== len) return null;

  return total;
};

function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8);
  }

  // `parseFloat(value)` stops parsing at the first numeric separator then returns a wrong value.
  return parseFloat(str.replace(/_/g, ""));
}

function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null;
  }

  // `BigInt(value)` throws syntax error if the string contains numeric separators.
  return BigInt(str.replace(/_/g, ""));
}

pp.readRadixNumber = function (radix) {
  let start = this.pos;
  this.pos += 2; // 0x
  let val = this.readInt(radix);
  if (val == null) this.raise(this.start + 2, "Expected number in radix " + radix);
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if ((0, _identifier.isIdentifierStart)(this.fullCharCodeAtPos())) this.raise(this.pos, "Identifier directly after number");
  return this.finishToken(_tokentype.types.num, val);
};

// Read an integer, octal integer, or floating-point number.

pp.readNumber = function (startsWithDot) {
  let start = this.pos;
  if (!startsWithDot && this.readInt(10, undefined, true) === null) this.raise(start, "Invalid number");
  let octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) this.raise(start, "Invalid number");
  let next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    let val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if ((0, _identifier.isIdentifierStart)(this.fullCharCodeAtPos())) this.raise(this.pos, "Identifier directly after number");
    return this.finishToken(_tokentype.types.num, val);
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) octal = false;
  if (next === 46 && !octal) {
    // '.'
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) {
    // 'eE'
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) ++this.pos; // '+-'
    if (this.readInt(10) === null) this.raise(start, "Invalid number");
  }
  if ((0, _identifier.isIdentifierStart)(this.fullCharCodeAtPos())) this.raise(this.pos, "Identifier directly after number");

  let val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(_tokentype.types.num, val);
};

// Read a string value, interpreting backslash-escapes.

pp.readCodePoint = function () {
  let ch = this.input.charCodeAt(this.pos),
      code;

  if (ch === 123) {
    // '{'
    if (this.options.ecmaVersion < 6) this.unexpected();
    let codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 0x10FFFF) this.invalidStringToken(codePos, "Code point out of bounds");
  } else {
    code = this.readHexChar(4);
  }
  return code;
};

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) return String.fromCharCode(code);
  code -= 0x10000;
  return String.fromCharCode((code >> 10) + 0xD800, (code & 1023) + 0xDC00);
}

pp.readString = function (quote) {
  let out = "",
      chunkStart = ++this.pos;
  for (;;) {
    if (this.pos >= this.input.length) this.raise(this.start, "Unterminated string constant");
    let ch = this.input.charCodeAt(this.pos);
    if (ch === quote) break;
    if (ch === 92) {
      // '\'
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else {
      if ((0, _whitespace.isNewLine)(ch, this.options.ecmaVersion >= 10)) this.raise(this.start, "Unterminated string constant");
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(_tokentype.types.string, out);
};

// Reads template string tokens.

const INVALID_TEMPLATE_ESCAPE_ERROR = {};

pp.tryReadTemplateToken = function () {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err;
    }
  }

  this.inTemplateElement = false;
};

pp.invalidStringToken = function (position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR;
  } else {
    this.raise(position, message);
  }
};

pp.readTmplToken = function () {
  let out = "",
      chunkStart = this.pos;
  for (;;) {
    if (this.pos >= this.input.length) this.raise(this.start, "Unterminated template");
    let ch = this.input.charCodeAt(this.pos);
    if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) {
      // '`', '${'
      if (this.pos === this.start && (this.type === _tokentype.types.template || this.type === _tokentype.types.invalidTemplate)) {
        if (ch === 36) {
          this.pos += 2;
          return this.finishToken(_tokentype.types.dollarBraceL);
        } else {
          ++this.pos;
          return this.finishToken(_tokentype.types.backQuote);
        }
      }
      out += this.input.slice(chunkStart, this.pos);
      return this.finishToken(_tokentype.types.template, out);
    }
    if (ch === 92) {
      // '\'
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(true);
      chunkStart = this.pos;
    } else if ((0, _whitespace.isNewLine)(ch)) {
      out += this.input.slice(chunkStart, this.pos);
      ++this.pos;
      switch (ch) {
        case 13:
          if (this.input.charCodeAt(this.pos) === 10) ++this.pos;
        case 10:
          out += "\n";
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      chunkStart = this.pos;
    } else {
      ++this.pos;
    }
  }
};

// Reads a template token to search for the end, without validating any escape sequences
pp.readInvalidTemplateToken = function () {
  for (; this.pos < this.input.length; this.pos++) {
    switch (this.input[this.pos]) {
      case "\\":
        ++this.pos;
        break;

      case "$":
        if (this.input[this.pos + 1] !== "{") {
          break;
        }
      // falls through

      case "`":
        return this.finishToken(_tokentype.types.invalidTemplate, this.input.slice(this.start, this.pos));

      // no default
    }
  }
  this.raise(this.start, "Unterminated template");
};

// Used to read escaped characters

pp.readEscapedChar = function (inTemplate) {
  let ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
    case 110:
      return "\n"; // 'n' -> '\n'
    case 114:
      return "\r"; // 'r' -> '\r'
    case 120:
      return String.fromCharCode(this.readHexChar(2)); // 'x'
    case 117:
      return codePointToString(this.readCodePoint()); // 'u'
    case 116:
      return "\t"; // 't' -> '\t'
    case 98:
      return "\b"; // 'b' -> '\b'
    case 118:
      return "\u000b"; // 'v' -> '\u000b'
    case 102:
      return "\f"; // 'f' -> '\f'
    case 13:
      if (this.input.charCodeAt(this.pos) === 10) ++this.pos; // '\r\n'
    case 10:
      // ' \n'
      if (this.options.locations) {
        this.lineStart = this.pos;++this.curLine;
      }
      return "";
    case 56:
    case 57:
      if (this.strict) {
        this.invalidStringToken(this.pos - 1, "Invalid escape sequence");
      }
      if (inTemplate) {
        const codePos = this.pos - 1;

        this.invalidStringToken(codePos, "Invalid escape sequence in template string");

        return null;
      }
    default:
      if (ch >= 48 && ch <= 55) {
        let octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
        let octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        this.pos += octalStr.length - 1;
        ch = this.input.charCodeAt(this.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
          this.invalidStringToken(this.pos - 1 - octalStr.length, inTemplate ? "Octal literal in template string" : "Octal literal in strict mode");
        }
        return String.fromCharCode(octal);
      }
      if ((0, _whitespace.isNewLine)(ch)) {
        // Unicode new line characters after \ get removed from output in both
        // template literals and strings
        return "";
      }
      return String.fromCharCode(ch);
  }
};

// Used to read character escape sequences ('\x', '\u', '\U').

pp.readHexChar = function (len) {
  let codePos = this.pos;
  let n = this.readInt(16, len);
  if (n === null) this.invalidStringToken(codePos, "Bad character escape sequence");
  return n;
};

// Read an identifier, and return it as a string. Sets `this.containsEsc`
// to whether the word contained a '\u' escape.
//
// Incrementally adds only escaped chars, adding other chunks as-is
// as a micro-optimization.

pp.readWord1 = function () {
  this.containsEsc = false;
  let word = "",
      first = true,
      chunkStart = this.pos;
  let astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    let ch = this.fullCharCodeAtPos();
    if ((0, _identifier.isIdentifierChar)(ch, astral)) {
      this.pos += ch <= 0xffff ? 1 : 2;
    } else if (ch === 92) {
      // "\"
      this.containsEsc = true;
      word += this.input.slice(chunkStart, this.pos);
      let escStart = this.pos;
      if (this.input.charCodeAt(++this.pos) !== 117) // "u"
        this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX");
      ++this.pos;
      let esc = this.readCodePoint();
      if (!(first ? _identifier.isIdentifierStart : _identifier.isIdentifierChar)(esc, astral)) this.invalidStringToken(escStart, "Invalid Unicode escape");
      word += this.input.substr(this.pos - 6, 6);
      chunkStart = this.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos);
};

// Read an identifier or keyword token. Will check for reserved
// words when necessary.

pp.readWord = function () {
  let word = this.readWord1();
  let type = _tokentype.types.name;
  if (this.keywords.test(word)) {
    type = _tokentype.keywords[word];
  }
  return this.finishToken(type, word);
};
},{"./identifier.js":2,"./locutil.js":4,"./regexp.js":9,"./state.js":12,"./tokentype.js":16,"./whitespace.js":19}],16:[function(require,module,exports){
"use strict";

exports.__esModule = true;
// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

// All token type variables start with an underscore, to make them
// easy to recognize.

// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// The `startsExpr` property is used to check if the token ends a
// `yield` expression. It is set on all token types that either can
// directly start an expression (like a quotation mark) or can
// continue an expression (like the body of a string).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.

class TokenType {
  constructor(label, conf = {}) {
    this.label = label;
    this.keyword = conf.keyword;
    this.beforeExpr = !!conf.beforeExpr;
    this.startsExpr = !!conf.startsExpr;
    this.isLoop = !!conf.isLoop;
    this.isAssign = !!conf.isAssign;
    this.prefix = !!conf.prefix;
    this.postfix = !!conf.postfix;
    this.binop = conf.binop || null;
    this.updateContext = null;
  }
}

exports.TokenType = TokenType;
function binop(name, prec) {
  return new TokenType(name, { beforeExpr: true, binop: prec });
}
const beforeExpr = { beforeExpr: true },
      startsExpr = { startsExpr: true

  // Map keyword names to token types.

};const keywords = exports.keywords = {};

// Succinct definitions of keyword token types
function kw(name, options = {}) {
  options.keyword = name;
  return keywords[name] = new TokenType(name, options);
}

const types = exports.types = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  eof: new TokenType("eof"),

  // Punctuation token types.
  bracketL: new TokenType("[", { beforeExpr: true, startsExpr: true }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr: true, startsExpr: true }),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", { beforeExpr: true, startsExpr: true }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", { beforeExpr: true, startsExpr: true }),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType("=", { beforeExpr: true, isAssign: true }),
  assign: new TokenType("_=", { beforeExpr: true, isAssign: true }),
  incDec: new TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }),
  prefix: new TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", { beforeExpr: true }),
  coalesce: binop("??", 1),

  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", { isLoop: true, beforeExpr: true }),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", { isLoop: true }),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", { isLoop: true }),
  _with: kw("with"),
  _new: kw("new", { beforeExpr: true, startsExpr: true }),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", { beforeExpr: true, binop: 7 }),
  _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }),
  _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }),
  _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }),
  _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true })
};
},{}],17:[function(require,module,exports){
"use strict";

exports.__esModule = true;

var _util = require("./util.js");

// This file contains Unicode properties extracted from the ECMAScript
// specification. The lists are extracted like so:
// $$('#table-binary-unicode-properties > figure > table > tbody > tr > td:nth-child(1) code').map(el => el.innerText)

// #table-binary-unicode-properties
const ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
const ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
const ecma11BinaryProperties = ecma10BinaryProperties;
const ecma12BinaryProperties = ecma11BinaryProperties + " EBase EComp EMod EPres ExtPict";
const unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma10BinaryProperties,
  11: ecma11BinaryProperties,
  12: ecma12BinaryProperties

  // #table-unicode-general-category-values
};const unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";

// #table-unicode-script-values
const ecma9ScriptValues = "Adlam Adlm Ahom Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
const ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
const ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
const ecma12ScriptValues = ecma11ScriptValues + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi";
const unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma10ScriptValues,
  11: ecma11ScriptValues,
  12: ecma12ScriptValues
};

const data = {};
function buildUnicodeData(ecmaVersion) {
  let d = data[ecmaVersion] = {
    binary: (0, _util.wordsRegexp)(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
    nonBinary: {
      General_Category: (0, _util.wordsRegexp)(unicodeGeneralCategoryValues),
      Script: (0, _util.wordsRegexp)(unicodeScriptValues[ecmaVersion])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;

  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}
buildUnicodeData(9);
buildUnicodeData(10);
buildUnicodeData(11);
buildUnicodeData(12);

exports.default = data;
module.exports = exports['default'];
},{"./util.js":18}],18:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.has = has;
exports.wordsRegexp = wordsRegexp;
var _Object$prototype = Object.prototype;
const hasOwnProperty = _Object$prototype.hasOwnProperty,
      toString = _Object$prototype.toString;

// Checks if an object has a property.

function has(obj, propName) {
  return hasOwnProperty.call(obj, propName);
}

const isArray = exports.isArray = Array.isArray || (obj => toString.call(obj) === "[object Array]");

function wordsRegexp(words) {
  return new RegExp("^(?:" + words.replace(/ /g, "|") + ")$");
}
},{}],19:[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.isNewLine = isNewLine;
// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.

const lineBreak = exports.lineBreak = /\r\n?|\n|\u2028|\u2029/;
const lineBreakG = exports.lineBreakG = new RegExp(lineBreak.source, "g");

function isNewLine(code, ecma2019String) {
  return code === 10 || code === 13 || !ecma2019String && (code === 0x2028 || code === 0x2029);
}

const nonASCIIwhitespace = exports.nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

const skipWhiteSpace = exports.skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
},{}],"acorn-hammerhead":[function(require,module,exports){
"use strict";

exports.__esModule = true;
exports.nonASCIIwhitespace = exports.lineBreakG = exports.lineBreak = exports.isNewLine = exports.Token = exports.isIdentifierStart = exports.isIdentifierChar = exports.tokContexts = exports.TokContext = exports.keywordTypes = exports.tokTypes = exports.TokenType = exports.Node = exports.getLineInfo = exports.SourceLocation = exports.Position = exports.defaultOptions = exports.Parser = exports.version = undefined;
exports.parse = parse;
exports.parseExpressionAt = parseExpressionAt;
exports.tokenizer = tokenizer;

var _state = require("./state.js");

require("./parseutil.js");

require("./statement.js");

require("./lval.js");

require("./expression.js");

require("./location.js");

require("./scope.js");

var _options = require("./options.js");

var _locutil = require("./locutil.js");

var _node = require("./node.js");

var _tokentype = require("./tokentype.js");

var _tokencontext = require("./tokencontext.js");

var _identifier = require("./identifier.js");

var _tokenize = require("./tokenize.js");

var _whitespace = require("./whitespace.js");

const version = exports.version = "8.1.0"; // Acorn is a tiny, fast JavaScript parser written in JavaScript.
//
// Acorn was written by Marijn Haverbeke, Ingvar Stepanyan, and
// various contributors and released under an MIT license.
//
// Git repositories for Acorn are available at
//
//     http://marijnhaverbeke.nl/git/acorn
//     https://github.com/acornjs/acorn.git
//
// Please use the [github bug tracker][ghbt] to report issues.
//
// [ghbt]: https://github.com/acornjs/acorn/issues
//
// [walk]: util/walk.js

exports.Parser = _state.Parser;
exports.defaultOptions = _options.defaultOptions;
exports.Position = _locutil.Position;
exports.SourceLocation = _locutil.SourceLocation;
exports.getLineInfo = _locutil.getLineInfo;
exports.Node = _node.Node;
exports.TokenType = _tokentype.TokenType;
exports.tokTypes = _tokentype.types;
exports.keywordTypes = _tokentype.keywords;
exports.TokContext = _tokencontext.TokContext;
exports.tokContexts = _tokencontext.types;
exports.isIdentifierChar = _identifier.isIdentifierChar;
exports.isIdentifierStart = _identifier.isIdentifierStart;
exports.Token = _tokenize.Token;
exports.isNewLine = _whitespace.isNewLine;
exports.lineBreak = _whitespace.lineBreak;
exports.lineBreakG = _whitespace.lineBreakG;
exports.nonASCIIwhitespace = _whitespace.nonASCIIwhitespace;


_state.Parser.acorn = {
  Parser: _state.Parser,
  version,
  defaultOptions: _options.defaultOptions,
  Position: _locutil.Position,
  SourceLocation: _locutil.SourceLocation,
  getLineInfo: _locutil.getLineInfo,
  Node: _node.Node,
  TokenType: _tokentype.TokenType,
  tokTypes: _tokentype.types,
  keywordTypes: _tokentype.keywords,
  TokContext: _tokencontext.TokContext,
  tokContexts: _tokencontext.types,
  isIdentifierChar: _identifier.isIdentifierChar,
  isIdentifierStart: _identifier.isIdentifierStart,
  Token: _tokenize.Token,
  isNewLine: _whitespace.isNewLine,
  lineBreak: _whitespace.lineBreak,
  lineBreakG: _whitespace.lineBreakG,
  nonASCIIwhitespace: _whitespace.nonASCIIwhitespace

  // The main exported interface (under `self.acorn` when in the
  // browser) is a `parse` function that takes a code string and
  // returns an abstract syntax tree as specified by [Mozilla parser
  // API][api].
  //
  // [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API

};function parse(input, options) {
  return _state.Parser.parse(input, options);
}

// This function tries to parse a single expression at a given
// offset in a string. Useful for parsing mixed-language formats
// that embed JavaScript expressions.

function parseExpressionAt(input, pos, options) {
  return _state.Parser.parseExpressionAt(input, pos, options);
}

// Acorn is organized as a tokenizer and a recursive-descent parser.
// The `tokenizer` export provides an interface to the tokenizer.

function tokenizer(input, options) {
  return _state.Parser.tokenizer(input, options);
}
},{"./expression.js":1,"./identifier.js":2,"./location.js":3,"./locutil.js":4,"./lval.js":5,"./node.js":6,"./options.js":7,"./parseutil.js":8,"./scope.js":10,"./state.js":12,"./statement.js":13,"./tokencontext.js":14,"./tokenize.js":15,"./tokentype.js":16,"./whitespace.js":19}],"esotope-hammerhead":[function(require,module,exports){
// -------------------------------------------------------------
// WARNING: this file is used by both the client and the server.
// Do not use any browser or node-specific API!
// -------------------------------------------------------------

/*
 Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>
 Copyright (C) 2012-2014 Yusuke Suzuki <utatane.tea@gmail.com>
 Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
 Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
 Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
 Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
 Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
 Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
 Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
 Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
 Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright
 notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in the
 documentation and/or other materials provided with the distribution.

 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
 DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var isArray,
    json,
    renumber,
    hexadecimal,
    quotes,
    escapeless,
    parentheses,
    semicolons,
    safeConcatenation,
    directive,
    extra,
    parse;

var Syntax = {
    AssignmentExpression:     'AssignmentExpression',
    AssignmentPattern:        'AssignmentPattern',
    ArrayExpression:          'ArrayExpression',
    ArrayPattern:             'ArrayPattern',
    ArrowFunctionExpression:  'ArrowFunctionExpression',
    AwaitExpression:          'AwaitExpression',
    BlockStatement:           'BlockStatement',
    BinaryExpression:         'BinaryExpression',
    BreakStatement:           'BreakStatement',
    CallExpression:           'CallExpression',
    CatchClause:              'CatchClause',
    ClassBody:                'ClassBody',
    ClassDeclaration:         'ClassDeclaration',
    ClassExpression:          'ClassExpression',
    ComprehensionBlock:       'ComprehensionBlock',
    ComprehensionExpression:  'ComprehensionExpression',
    ConditionalExpression:    'ConditionalExpression',
    ContinueStatement:        'ContinueStatement',
    DirectiveStatement:       'DirectiveStatement',
    DoWhileStatement:         'DoWhileStatement',
    DebuggerStatement:        'DebuggerStatement',
    EmptyStatement:           'EmptyStatement',
    ExportAllDeclaration:     'ExportAllDeclaration',
    ExportBatchSpecifier:     'ExportBatchSpecifier',
    ExportDeclaration:        'ExportDeclaration',
    ExportNamedDeclaration:   'ExportNamedDeclaration',
    ExportSpecifier:          'ExportSpecifier',
    ExpressionStatement:      'ExpressionStatement',
    ForStatement:             'ForStatement',
    ForInStatement:           'ForInStatement',
    ForOfStatement:           'ForOfStatement',
    FunctionDeclaration:      'FunctionDeclaration',
    FunctionExpression:       'FunctionExpression',
    GeneratorExpression:      'GeneratorExpression',
    Identifier:               'Identifier',
    IfStatement:              'IfStatement',
    ImportExpression:         'ImportExpression',
    ImportSpecifier:          'ImportSpecifier',
    ImportDeclaration:        'ImportDeclaration',
    ChainExpression:          'ChainExpression',
    Literal:                  'Literal',
    LabeledStatement:         'LabeledStatement',
    LogicalExpression:        'LogicalExpression',
    MemberExpression:         'MemberExpression',
    MetaProperty:             'MetaProperty',
    MethodDefinition:         'MethodDefinition',
    ModuleDeclaration:        'ModuleDeclaration',
    NewExpression:            'NewExpression',
    ObjectExpression:         'ObjectExpression',
    ObjectPattern:            'ObjectPattern',
    Program:                  'Program',
    Property:                 'Property',
    RestElement:              'RestElement',
    ReturnStatement:          'ReturnStatement',
    SequenceExpression:       'SequenceExpression',
    SpreadElement:            'SpreadElement',
    Super:                    'Super',
    SwitchStatement:          'SwitchStatement',
    SwitchCase:               'SwitchCase',
    TaggedTemplateExpression: 'TaggedTemplateExpression',
    TemplateElement:          'TemplateElement',
    TemplateLiteral:          'TemplateLiteral',
    ThisExpression:           'ThisExpression',
    ThrowStatement:           'ThrowStatement',
    TryStatement:             'TryStatement',
    UnaryExpression:          'UnaryExpression',
    UpdateExpression:         'UpdateExpression',
    VariableDeclaration:      'VariableDeclaration',
    VariableDeclarator:       'VariableDeclarator',
    WhileStatement:           'WhileStatement',
    WithStatement:            'WithStatement',
    YieldExpression:          'YieldExpression'
};

exports.Syntax = Syntax;

var Precedence = {
    Sequence:         0,
    Yield:            1,
    Assignment:       1,
    Conditional:      2,
    ArrowFunction:    2,
    Coalesce:         3,
    LogicalOR:        3,
    LogicalAND:       4,
    BitwiseOR:        5,
    BitwiseXOR:       6,
    BitwiseAND:       7,
    Equality:         8,
    Relational:       9,
    BitwiseSHIFT:     10,
    Additive:         11,
    Multiplicative:   12,
    Unary:            13,
    Exponentiation:   14,
    Postfix:          14,
    Await:            14,
    Call:             15,
    New:              16,
    TaggedTemplate:   17,
    OptionalChaining: 17,
    Member:           18,
    Primary:          19
};

var BinaryPrecedence = {
    '||':         Precedence.LogicalOR,
    '&&':         Precedence.LogicalAND,
    '|':          Precedence.BitwiseOR,
    '^':          Precedence.BitwiseXOR,
    '&':          Precedence.BitwiseAND,
    '==':         Precedence.Equality,
    '!=':         Precedence.Equality,
    '===':        Precedence.Equality,
    '!==':        Precedence.Equality,
    'is':         Precedence.Equality,
    'isnt':       Precedence.Equality,
    '<':          Precedence.Relational,
    '>':          Precedence.Relational,
    '<=':         Precedence.Relational,
    '>=':         Precedence.Relational,
    'in':         Precedence.Relational,
    'instanceof': Precedence.Relational,
    '<<':         Precedence.BitwiseSHIFT,
    '>>':         Precedence.BitwiseSHIFT,
    '>>>':        Precedence.BitwiseSHIFT,
    '+':          Precedence.Additive,
    '-':          Precedence.Additive,
    '*':          Precedence.Multiplicative,
    '%':          Precedence.Multiplicative,
    '/':          Precedence.Multiplicative,
    '??':         Precedence.Coalesce,
    '**':         Precedence.Exponentiation
};

function getDefaultOptions () {
    // default options
    return {
        indent:    null,
        base:      null,
        parse:     null,
        format:    {
            indent:            {
                style: '    ',
                base:  0
            },
            newline:           '\n',
            space:             ' ',
            json:              false,
            renumber:          false,
            hexadecimal:       false,
            quotes:            'single',
            escapeless:        false,
            compact:           false,
            parentheses:       true,
            semicolons:        true,
            safeConcatenation: false
        },
        directive: false,
        raw:       true,
        verbatim:  null
    };
}

//-------------------------------------------------===------------------------------------------------------
//                                            Lexical utils
//-------------------------------------------------===------------------------------------------------------

//Const
var NON_ASCII_WHITESPACES = [
    0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
    0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000,
    0xFEFF
];

//Regular expressions
var NON_ASCII_IDENTIFIER_CHARACTERS_REGEXP = new RegExp(
    '[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376' +
    '\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-' +
    '\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA' +
    '\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-' +
    '\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-' +
    '\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-' +
    '\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-' +
    '\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38' +
    '\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83' +
    '\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9' +
    '\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-' +
    '\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-' +
    '\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E' +
    '\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-' +
    '\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-' +
    '\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-' +
    '\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE' +
    '\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44' +
    '\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-' +
    '\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A' +
    '\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-' +
    '\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9' +
    '\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84' +
    '\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-' +
    '\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5' +
    '\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-' +
    '\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-' +
    '\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD' +
    '\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B' +
    '\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E' +
    '\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-' +
    '\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-' +
    '\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-' +
    '\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F' +
    '\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115' +
    '\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188' +
    '\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-' +
    '\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-' +
    '\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A' +
    '\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5' +
    '\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697' +
    '\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873' +
    '\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-' +
    '\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-' +
    '\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC' +
    '\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-' +
    '\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D' +
    '\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74' +
    '\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-' +
    '\uFFD7\uFFDA-\uFFDC]'
);


//Methods
function isIdentifierCh (cp) {
    if (cp < 0x80) {
        return cp >= 97 && cp <= 122 ||      // a..z
               cp >= 65 && cp <= 90 ||       // A..Z
               cp >= 48 && cp <= 57 ||       // 0..9
               cp === 36 || cp === 95 ||     // $ (dollar) and _ (underscore)
               cp === 92;                    // \ (backslash)
    }

    var ch = String.fromCharCode(cp);

    return NON_ASCII_IDENTIFIER_CHARACTERS_REGEXP.test(ch);
}

function isLineTerminator (cp) {
    return cp === 0x0A || cp === 0x0D || cp === 0x2028 || cp === 0x2029;
}

function isWhitespace (cp) {
    return cp === 0x20 || cp === 0x09 || isLineTerminator(cp) || cp === 0x0B || cp === 0x0C || cp === 0xA0 ||
           (cp >= 0x1680 && NON_ASCII_WHITESPACES.indexOf(cp) >= 0);
}

function isDecimalDigit (cp) {
    return cp >= 48 && cp <= 57;
}

function stringRepeat (str, num) {
    var result = '';

    for (num |= 0; num > 0; num >>>= 1, str += str) {
        if (num & 1) {
            result += str;
        }
    }

    return result;
}

isArray = Array.isArray;
if (!isArray) {
    isArray = function isArray (array) {
        return Object.prototype.toString.call(array) === '[object Array]';
    };
}


function updateDeeply (target, override) {
    var key, val;

    function isHashObject (target) {
        return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
    }

    for (key in override) {
        if (override.hasOwnProperty(key)) {
            val = override[key];
            if (isHashObject(val)) {
                if (isHashObject(target[key])) {
                    updateDeeply(target[key], val);
                }
                else {
                    target[key] = updateDeeply({}, val);
                }
            }
            else {
                target[key] = val;
            }
        }
    }
    return target;
}

function generateNumber (value) {
    var result, point, temp, exponent, pos;

    if (value === 1 / 0) {
        return json ? 'null' : renumber ? '1e400' : '1e+400';
    }

    result = '' + value;
    if (!renumber || result.length < 3) {
        return result;
    }

    point = result.indexOf('.');
    //NOTE: 0x30 == '0'
    if (!json && result.charCodeAt(0) === 0x30 && point === 1) {
        point  = 0;
        result = result.slice(1);
    }
    temp     = result;
    result   = result.replace('e+', 'e');
    exponent = 0;
    if ((pos = temp.indexOf('e')) > 0) {
        exponent = +temp.slice(pos + 1);
        temp     = temp.slice(0, pos);
    }
    if (point >= 0) {
        exponent -= temp.length - point - 1;
        temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
    }
    pos = 0;

    //NOTE: 0x30 == '0'
    while (temp.charCodeAt(temp.length + pos - 1) === 0x30) {
        --pos;
    }
    if (pos !== 0) {
        exponent -= pos;
        temp = temp.slice(0, pos);
    }
    if (exponent !== 0) {
        temp += 'e' + exponent;
    }
    if ((temp.length < result.length ||
         (hexadecimal && value > 1e12 && Math.floor(value) === value &&
          (temp = '0x' + value.toString(16)).length
          < result.length)) &&
        +temp === value) {
        result = temp;
    }

    return result;
}

// Generate valid RegExp expression.
// This function is based on https://github.com/Constellation/iv Engine

function escapeRegExpCharacter (ch, previousIsBackslash) {
    // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
    if ((ch & ~1) === 0x2028) {
        return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
    }
    else if (ch === 10 || ch === 13) {  // \n, \r
        return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
    }
    return String.fromCharCode(ch);
}

function generateRegExp (reg) {
    var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

    result = reg.toString();

    if (reg.source) {
        // extract flag from toString result
        match = result.match(/\/([^/]*)$/);
        if (!match) {
            return result;
        }

        flags  = match[1];
        result = '';

        characterInBrack    = false;
        previousIsBackslash = false;
        for (i = 0, iz = reg.source.length; i < iz; ++i) {
            ch = reg.source.charCodeAt(i);

            if (!previousIsBackslash) {
                if (characterInBrack) {
                    if (ch === 93) {  // ]
                        characterInBrack = false;
                    }
                }
                else {
                    if (ch === 47) {  // /
                        result += '\\';
                    }
                    else if (ch === 91) {  // [
                        characterInBrack = true;
                    }
                }
                result += escapeRegExpCharacter(ch, previousIsBackslash);
                previousIsBackslash = ch === 92;  // \
            }
            else {
                // if new RegExp("\\\n') is provided, create /\n/
                result += escapeRegExpCharacter(ch, previousIsBackslash);
                // prevent like /\\[/]/
                previousIsBackslash = false;
            }
        }

        return '/' + result + '/' + flags;
    }

    return result;
}

function escapeAllowedCharacter (code, next) {
    var hex, result = '\\';

    switch (code) {
        case 0x08:          // \b
            result += 'b';
            break;
        case 0x0C:          // \f
            result += 'f';
            break;
        case 0x09:          // \t
            result += 't';
            break;
        default:
            hex = code.toString(16).toUpperCase();
            if (json || code > 0xFF) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            }

            else if (code === 0x0000 && !isDecimalDigit(next)) {
                result += '0';
            }

            else if (code === 0x000B) {     // \v
                result += 'x0B';
            }

            else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
    }

    return result;
}

function escapeDisallowedCharacter (code) {
    var result = '\\';
    switch (code) {
        case 0x5C       // \
        :
            result += '\\';
            break;
        case 0x0A       // \n
        :
            result += 'n';
            break;
        case 0x0D       // \r
        :
            result += 'r';
            break;
        case 0x2028:
            result += 'u2028';
            break;
        case 0x2029:
            result += 'u2029';
            break;
    }

    return result;
}

function escapeDirective (str) {
    var i, iz, code, quote;

    quote = quotes === 'double' ? '"' : '\'';
    for (i = 0, iz = str.length; i < iz; ++i) {
        code = str.charCodeAt(i);
        if (code === 0x27) {            // '
            quote = '"';
            break;
        }
        else if (code === 0x22) {     // "
            quote = '\'';
            break;
        }
        else if (code === 0x5C) {     // \
            ++i;
        }
    }

    return quote + str + quote;
}

function escapeString (str) {
    var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;
    //TODO http://jsperf.com/character-counting/8
    for (i = 0, len = str.length; i < len; ++i) {
        code = str.charCodeAt(i);
        if (code === 0x27) {           // '
            ++singleQuotes;
        }
        else if (code === 0x22) { // "
            ++doubleQuotes;
        }
        else if (code === 0x2F && json) { // /
            result += '\\';
        }
        else if (isLineTerminator(code) || code === 0x5C) { // \
            result += escapeDisallowedCharacter(code);
            continue;
        }
        else if ((json && code < 0x20) ||                                     // SP
                 !(json || escapeless || (code >= 0x20 && code <= 0x7E))) {   // SP, ~
            result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
            continue;
        }
        result += String.fromCharCode(code);
    }

    single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
    quote  = single ? '\'' : '"';

    if (!(single ? singleQuotes : doubleQuotes)) {
        return quote + result + quote;
    }

    str    = result;
    result = quote;

    for (i = 0, len = str.length; i < len; ++i) {
        code = str.charCodeAt(i);
        if ((code === 0x27 && single) || (code === 0x22 && !single)) {    // ', "
            result += '\\';
        }
        result += String.fromCharCode(code);
    }

    return result + quote;
}


function join (l, r) {
    if (!l.length)
        return r;

    if (!r.length)
        return l;

    var lCp = l.charCodeAt(l.length - 1),
        rCp = r.charCodeAt(0);

    if (isIdentifierCh(lCp) && isIdentifierCh(rCp) ||
        lCp === rCp && (lCp === 0x2B || lCp === 0x2D) ||   // + +, - -
        lCp === 0x2F && rCp === 0x69) {                    // /re/ instanceof foo
        return l + _.space + r;
    }

    else if (isWhitespace(lCp) || isWhitespace(rCp))
        return l + r;

    return l + _.optSpace + r;
}

function shiftIndent () {
    var prevIndent = _.indent;

    _.indent += _.indentUnit;
    return prevIndent;
}

function adoptionPrefix ($stmt) {
    if ($stmt.type === Syntax.BlockStatement)
        return _.optSpace;

    if ($stmt.type === Syntax.EmptyStatement)
        return '';

    return _.newline + _.indent + _.indentUnit;
}

function adoptionSuffix ($stmt) {
    if ($stmt.type === Syntax.BlockStatement)
        return _.optSpace;

    return _.newline + _.indent;
}

//Subentities generators
function generateVerbatim ($expr, settings) {
    var verbatim     = $expr[extra.verbatim],
        strVerbatim  = typeof verbatim === 'string',
        precedence   = !strVerbatim &&
                       verbatim.precedence !== void 0 ? verbatim.precedence : Precedence.Sequence,
        parenthesize = precedence < settings.precedence,
        content      = strVerbatim ? verbatim : verbatim.content,
        chunks       = content.split(/\r\n|\n/),
        chunkCount   = chunks.length;

    if (parenthesize)
        _.js += '(';

    _.js += chunks[0];

    for (var i = 1; i < chunkCount; i++)
        _.js += _.newline + _.indent + chunks[i];

    if (parenthesize)
        _.js += ')';
}

function generateFunctionParams ($node) {
    var $params                     = $node.params,
        paramCount                  = $params.length,
        lastParamIdx                = paramCount - 1,
        arrowFuncWithoutParentheses = $node.type === Syntax.ArrowFunctionExpression && paramCount === 1 &&
                                      $params[0].type === Syntax.Identifier;

    //NOTE: arg => { } case
    if (arrowFuncWithoutParentheses)
        _.js += $params[0].name;

    else {
        _.js += '(';

        for (var i = 0; i < paramCount; ++i) {
            var $param = $params[i];

            if ($params[i].type === Syntax.Identifier)
                _.js += $param.name;

            else
                ExprGen[$param.type]($param, Preset.e4);

            if (i !== lastParamIdx)
                _.js += ',' + _.optSpace;
        }

        _.js += ')';
    }
}

function generateFunctionBody ($node) {
    var $body = $node.body;

    generateFunctionParams($node);

    if ($node.type === Syntax.ArrowFunctionExpression)
        _.js += _.optSpace + '=>';

    if ($node.expression) {
        _.js += _.optSpace;

        var exprJs = exprToJs($body, Preset.e4);

        if (exprJs.charAt(0) === '{')
            exprJs = '(' + exprJs + ')';

        _.js += exprJs;
    }

    else {
        _.js += adoptionPrefix($body);
        StmtGen[$body.type]($body, Preset.s8);
    }
}


//-------------------------------------------------===------------------------------------------------------
//                                Syntactic entities generation presets
//-------------------------------------------------===------------------------------------------------------

var Preset = {
    e1: function (allowIn) {
        return {
            precedence:              Precedence.Assignment,
            allowIn:                 allowIn,
            allowCall:               true,
            allowUnparenthesizedNew: true
        };
    },

    e2: function (allowIn) {
        return {
            precedence:              Precedence.LogicalOR,
            allowIn:                 allowIn,
            allowCall:               true,
            allowUnparenthesizedNew: true
        };
    },

    e3: {
        precedence:              Precedence.Call,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: false
    },

    e4: {
        precedence:              Precedence.Assignment,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e5: {
        precedence:              Precedence.Sequence,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e6: function (allowUnparenthesizedNew) {
        return {
            precedence:              Precedence.New,
            allowIn:                 true,
            allowCall:               false,
            allowUnparenthesizedNew: allowUnparenthesizedNew
        };
    },

    e7: {
        precedence:              Precedence.Unary,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e8: {
        precedence:              Precedence.Postfix,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e9: {
        precedence:              void 0,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e10: {
        precedence:              Precedence.Call,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },

    e11: function (allowCall) {
        return {
            precedence:              Precedence.Call,
            allowIn:                 true,
            allowCall:               allowCall,
            allowUnparenthesizedNew: false
        };
    },

    e12: {
        precedence:              Precedence.Primary,
        allowIn:                 false,
        allowCall:               false,
        allowUnparenthesizedNew: true
    },

    e13: {
        precedence:              Precedence.Primary,
        allowIn:                 true,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },


    e14: {
        precedence:              Precedence.Sequence,
        allowIn:                 false,
        allowCall:               true,
        allowUnparenthesizedNew: true
    },


    e15: function (allowCall) {
        return {
            precedence:              Precedence.Sequence,
            allowIn:                 true,
            allowCall:               allowCall,
            allowUnparenthesizedNew: true
        };
    },

    e16: function (precedence, allowIn) {
        return {
            precedence:              precedence,
            allowIn:                 allowIn,
            allowCall:               true,
            allowUnparenthesizedNew: true
        };
    },

    e17: function (allowIn) {
        return {
            precedence:              Precedence.Call,
            allowIn:                 allowIn,
            allowCall:               true,
            allowUnparenthesizedNew: true
        }
    },

    e18: function (allowIn) {
        return {
            precedence:              Precedence.Assignment,
            allowIn:                 allowIn,
            allowCall:               true,
            allowUnparenthesizedNew: true
        }
    },

    e19: {
        precedence:        Precedence.Sequence,
        allowIn:           true,
        allowCall:         true,
        semicolonOptional: false
    },

    e20: {
        precedence: Precedence.Await,
        allowCall:  true
    },

    s1: function (functionBody, semicolonOptional) {
        return {
            allowIn:           true,
            functionBody:      false,
            directiveContext:  functionBody,
            semicolonOptional: semicolonOptional
        };
    },

    s2: {
        allowIn:           true,
        functionBody:      false,
        directiveContext:  false,
        semicolonOptional: true
    },

    s3: function (allowIn) {
        return {
            allowIn:           allowIn,
            functionBody:      false,
            directiveContext:  false,
            semicolonOptional: false
        };
    },

    s4: function (semicolonOptional) {
        return {
            allowIn:           true,
            functionBody:      false,
            directiveContext:  false,
            semicolonOptional: semicolonOptional
        };
    },

    s5: function (semicolonOptional) {
        return {
            allowIn:           true,
            functionBody:      false,
            directiveContext:  true,
            semicolonOptional: semicolonOptional,
        };
    },

    s6: {
        allowIn:           false,
        functionBody:      false,
        directiveContext:  false,
        semicolonOptional: false
    },

    s7: {
        allowIn:           true,
        functionBody:      false,
        directiveContext:  false,
        semicolonOptional: false
    },

    s8: {
        allowIn:           true,
        functionBody:      true,
        directiveContext:  false,
        semicolonOptional: false
    }
};


//-------------------------------------------------===-------------------------------------------------------
//                                             Expressions
//-------------------------------------------------===-------------------------------------------------------

//Regular expressions
var FLOATING_OR_OCTAL_REGEXP  = /[.eExX]|^0[0-9]+/,
    LAST_DECIMAL_DIGIT_REGEXP = /[0-9]$/;


//Common expression generators
function generateLogicalOrBinaryExpression ($expr, settings) {
    var op                 = $expr.operator,
        precedence         = BinaryPrecedence[$expr.operator],
        parenthesize       = precedence < settings.precedence,
        allowIn            = settings.allowIn || parenthesize,
        operandGenSettings = Preset.e16(precedence, allowIn),
        exprJs             = exprToJs($expr.left, operandGenSettings);

    parenthesize |= op === 'in' && !allowIn;

    if (parenthesize)
        _.js += '(';

    // 0x2F = '/'
    if (exprJs.charCodeAt(exprJs.length - 1) === 0x2F && isIdentifierCh(op.charCodeAt(0)))
        exprJs = exprJs + _.space + op;

    else
        exprJs = join(exprJs, op);

    operandGenSettings.precedence++;

    var rightJs = exprToJs($expr.right, operandGenSettings);

    //NOTE: If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
    if (op === '/' && rightJs.charAt(0) === '/' || op.slice(-1) === '<' && rightJs.slice(0, 3) === '!--')
        exprJs += _.space + rightJs;

    else
        exprJs = join(exprJs, rightJs);

    _.js += exprJs;

    if (parenthesize)
        _.js += ')';
}

function generateArrayPatternOrExpression ($expr) {
    var $elems    = $expr.elements,
        elemCount = $elems.length;

    if (elemCount) {
        var lastElemIdx = elemCount - 1,
            multiline   = elemCount > 1,
            prevIndent  = shiftIndent(),
            itemPrefix  = _.newline + _.indent;

        _.js += '[';

        for (var i = 0; i < elemCount; i++) {
            var $elem = $elems[i];

            if (multiline)
                _.js += itemPrefix;

            if ($elem)
                ExprGen[$elem.type]($elem, Preset.e4);

            if (i !== lastElemIdx || !$elem)
                _.js += ',';
        }

        _.indent = prevIndent;

        if (multiline)
            _.js += _.newline + _.indent;

        _.js += ']';
    }

    else
        _.js += '[]';
}

function generateGeneratorOrComprehensionExpression ($expr) {
    //NOTE: GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
    var $blocks     = $expr.blocks,
        $filter     = $expr.filter,
        isGenerator = $expr.type === Syntax.GeneratorExpression,
        exprJs      = isGenerator ? '(' : '[',
        bodyJs      = exprToJs($expr.body, Preset.e4);

    if ($blocks) {
        var prevIndent = shiftIndent(),
            blockCount = $blocks.length;

        for (var i = 0; i < blockCount; ++i) {
            var blockJs = exprToJs($blocks[i], Preset.e5);

            exprJs = i > 0 ? join(exprJs, blockJs) : (exprJs + blockJs);
        }

        _.indent = prevIndent;
    }

    if ($filter) {
        var filterJs = exprToJs($filter, Preset.e5);

        exprJs = join(exprJs, 'if' + _.optSpace);
        exprJs = join(exprJs, '(' + filterJs + ')');
    }

    exprJs = join(exprJs, bodyJs);
    exprJs += isGenerator ? ')' : ']';

    _.js += exprJs;
}


//Expression raw generator dictionary
var ExprRawGen = {
    SequenceExpression: function generateSequenceExpression ($expr, settings) {
        var $children       = $expr.expressions,
            childrenCount   = $children.length,
            lastChildIdx    = childrenCount - 1,
            parenthesize    = Precedence.Sequence < settings.precedence,
            exprGenSettings = Preset.e1(settings.allowIn || parenthesize);

        if (parenthesize)
            _.js += '(';

        for (var i = 0; i < childrenCount; i++) {
            var $child = $children[i];

            ExprGen[$child.type]($child, exprGenSettings);

            if (i !== lastChildIdx)
                _.js += ',' + _.optSpace;
        }

        if (parenthesize)
            _.js += ')';
    },

    AssignmentExpression: function generateAssignmentExpression ($expr, settings) {
        var $left        = $expr.left,
            $right       = $expr.right,
            parenthesize = Precedence.Assignment < settings.precedence,
            allowIn      = settings.allowIn || parenthesize;

        if (parenthesize)
            _.js += '(';

        ExprGen[$left.type]($left, Preset.e17(allowIn));
        _.js += _.optSpace + $expr.operator + _.optSpace;
        ExprGen[$right.type]($right, Preset.e18(allowIn));

        if (parenthesize)
            _.js += ')';
    },

    AssignmentPattern: function generateAssignmentPattern ($node) {
        var $fakeAssign = {
            left:     $node.left,
            right:    $node.right,
            operator: '='
        };

        ExprGen.AssignmentExpression($fakeAssign, Preset.e4);
    },

    ArrowFunctionExpression: function generateArrowFunctionExpression ($expr, settings) {
        var parenthesize = Precedence.ArrowFunction < settings.precedence;

        if (parenthesize)
            _.js += '(';

        if ($expr.async)
            _.js += 'async ';

        generateFunctionBody($expr);

        if (parenthesize)
            _.js += ')';
    },

    AwaitExpression: function generateAwaitExpression ($expr, settings) {
        var parenthesize = Precedence.Await < settings.precedence;

        if (parenthesize)
            _.js += '(';

        _.js += $expr.all ? 'await* ' : 'await ';

        ExprGen[$expr.argument.type]($expr.argument, Preset.e20);

        if (parenthesize)
            _.js += ')';
    },

    ConditionalExpression: function generateConditionalExpression ($expr, settings) {
        var $test             = $expr.test,
            $conseq           = $expr.consequent,
            $alt              = $expr.alternate,
            parenthesize      = Precedence.Conditional < settings.precedence,
            allowIn           = settings.allowIn || parenthesize,
            testGenSettings   = Preset.e2(allowIn),
            branchGenSettings = Preset.e1(allowIn);

        if (parenthesize)
            _.js += '(';

        ExprGen[$test.type]($test, testGenSettings);
        _.js += _.optSpace + '?' + _.optSpace;
        ExprGen[$conseq.type]($conseq, branchGenSettings);
        _.js += _.optSpace + ':' + _.optSpace;
        ExprGen[$alt.type]($alt, branchGenSettings);

        if (parenthesize)
            _.js += ')';
    },

    LogicalExpression: generateLogicalOrBinaryExpression,

    BinaryExpression: generateLogicalOrBinaryExpression,

    CallExpression: function generateCallExpression ($expr, settings) {
        var $callee      = $expr.callee,
            $args        = $expr['arguments'],
            argCount     = $args.length,
            lastArgIdx   = argCount - 1,
            parenthesize = !settings.allowCall || Precedence.Call < settings.precedence;

        if (parenthesize)
            _.js += '(';

        ExprGen[$callee.type]($callee, Preset.e3);

        if ($expr.optional)
            _.js += '?.';

        _.js += '(';

        for (var i = 0; i < argCount; ++i) {
            var $arg = $args[i];

            ExprGen[$arg.type]($arg, Preset.e4);

            if (i !== lastArgIdx)
                _.js += ',' + _.optSpace;
        }

        _.js += ')';

        if (parenthesize)
            _.js += ')';
    },

    NewExpression: function generateNewExpression ($expr, settings) {
        var $args        = $expr['arguments'],
            parenthesize = Precedence.New < settings.precedence,
            argCount     = $args.length,
            lastArgIdx   = argCount - 1,
            withCall     = !settings.allowUnparenthesizedNew || parentheses || argCount > 0,
            calleeJs     = exprToJs($expr.callee, Preset.e6(!withCall));

        if (parenthesize)
            _.js += '(';

        _.js += join('new', calleeJs);

        if (withCall) {
            _.js += '(';

            for (var i = 0; i < argCount; ++i) {
                var $arg = $args[i];

                ExprGen[$arg.type]($arg, Preset.e4);

                if (i !== lastArgIdx)
                    _.js += ',' + _.optSpace;
            }

            _.js += ')';
        }

        if (parenthesize)
            _.js += ')';
    },

    MemberExpression: function generateMemberExpression ($expr, settings) {
        var $obj         = $expr.object,
            $prop        = $expr.property,
            parenthesize = Precedence.Member < settings.precedence,
            isNumObj     = !$expr.computed && $obj.type === Syntax.Literal && typeof $obj.value === 'number';

        if (parenthesize)
            _.js += '(';

        if (isNumObj) {

            //NOTE: When the following conditions are all true:
            //   1. No floating point
            //   2. Don't have exponents
            //   3. The last character is a decimal digit
            //   4. Not hexadecimal OR octal number literal
            // then we should add a floating point.

            var numJs     = exprToJs($obj, Preset.e11(settings.allowCall)),
                withPoint = LAST_DECIMAL_DIGIT_REGEXP.test(numJs) && !FLOATING_OR_OCTAL_REGEXP.test(numJs);

            _.js += withPoint ? (numJs + '.') : numJs;
        }

        else
            ExprGen[$obj.type]($obj, Preset.e11(settings.allowCall));

        if ($expr.computed) {
            if ($expr.optional)
                _.js += '?.';

            _.js += '[';
            ExprGen[$prop.type]($prop, Preset.e15(settings.allowCall));
            _.js += ']';
        }

        else
            _.js += ($expr.optional ? '?.' : '.') + $prop.name;

        if (parenthesize)
            _.js += ')';
    },

    UnaryExpression: function generateUnaryExpression ($expr, settings) {
        var parenthesize = Precedence.Unary < settings.precedence,
            op           = $expr.operator,
            argJs        = exprToJs($expr.argument, Preset.e7);

        if (parenthesize)
            _.js += '(';

        //NOTE: delete, void, typeof
        // get `typeof []`, not `typeof[]`
        if (_.optSpace === '' || op.length > 2)
            _.js += join(op, argJs);

        else {
            _.js += op;

            //NOTE: Prevent inserting spaces between operator and argument if it is unnecessary
            // like, `!cond`
            var leftCp  = op.charCodeAt(op.length - 1),
                rightCp = argJs.charCodeAt(0);

            // 0x2B = '+', 0x2D =  '-'
            if (leftCp === rightCp && (leftCp === 0x2B || leftCp === 0x2D) ||
                isIdentifierCh(leftCp) && isIdentifierCh(rightCp)) {
                _.js += _.space;
            }

            _.js += argJs;
        }

        if (parenthesize)
            _.js += ')';
    },

    YieldExpression: function generateYieldExpression ($expr, settings) {
        var $arg         = $expr.argument,
            js           = $expr.delegate ? 'yield*' : 'yield',
            parenthesize = Precedence.Yield < settings.precedence;

        if (parenthesize)
            _.js += '(';

        if ($arg) {
            var argJs = exprToJs($arg, Preset.e4);

            js = join(js, argJs);
        }

        _.js += js;

        if (parenthesize)
            _.js += ')';
    },

    UpdateExpression: function generateUpdateExpression ($expr, settings) {
        var $arg         = $expr.argument,
            $op          = $expr.operator,
            prefix       = $expr.prefix,
            precedence   = prefix ? Precedence.Unary : Precedence.Postfix,
            parenthesize = precedence < settings.precedence;

        if (parenthesize)
            _.js += '(';

        if (prefix) {
            _.js += $op;
            ExprGen[$arg.type]($arg, Preset.e8);

        }

        else {
            ExprGen[$arg.type]($arg, Preset.e8);
            _.js += $op;
        }

        if (parenthesize)
            _.js += ')';
    },

    FunctionExpression: function generateFunctionExpression ($expr) {
        var isGenerator = !!$expr.generator;

        if ($expr.async)
            _.js += 'async ';

        _.js += isGenerator ? 'function*' : 'function';

        if ($expr.id) {
            _.js += isGenerator ? _.optSpace : _.space;
            _.js += $expr.id.name;
        }
        else
            _.js += _.optSpace;

        generateFunctionBody($expr);
    },

    ExportBatchSpecifier: function generateExportBatchSpecifier () {
        _.js += '*';
    },

    ArrayPattern: generateArrayPatternOrExpression,

    ArrayExpression: generateArrayPatternOrExpression,

    ClassExpression: function generateClassExpression ($expr) {
        var $id    = $expr.id,
            $super = $expr.superClass,
            $body  = $expr.body,
            exprJs = 'class';

        if ($id) {
            var idJs = exprToJs($id, Preset.e9);

            exprJs = join(exprJs, idJs);
        }

        if ($super) {
            var superJs = exprToJs($super, Preset.e4);

            superJs = join('extends', superJs);
            exprJs  = join(exprJs, superJs);
        }

        _.js += exprJs + _.optSpace;
        StmtGen[$body.type]($body, Preset.s2);
    },

    MetaProperty: function generateMetaProperty ($expr, settings) {
        var $meta        = $expr.meta,
            $property    = $expr.property,
            parenthesize = Precedence.Member < settings.precedence;

        if (parenthesize)
            _.js += '(';

        _.js += (typeof $meta === "string" ? $meta : $meta.name) +
            '.' + (typeof $property === "string" ? $property : $property.name);

        if (parenthesize)
            _.js += ')';
    },

    MethodDefinition: function generateMethodDefinition ($expr) {
        var exprJs = $expr['static'] ? 'static' + _.optSpace : '',
            keyJs  = exprToJs($expr.key, Preset.e5);

        if ($expr.computed)
            keyJs = '[' + keyJs + ']';

        if ($expr.kind === 'get' || $expr.kind === 'set') {
            keyJs = join($expr.kind, keyJs);
            _.js += join(exprJs, keyJs);
        }

        else {
            if ($expr.value.generator)
                _.js += exprJs + '*' + keyJs;
            else if ($expr.value.async)
                _.js += exprJs + 'async ' + keyJs;
            else
                _.js += join(exprJs, keyJs);
        }

        generateFunctionBody($expr.value);
    },

    Property: function generateProperty ($expr) {
        var $val  = $expr.value,
            $kind = $expr.kind,
            keyJs = exprToJs($expr.key, Preset.e4);

        if ($expr.computed)
            keyJs = '[' + keyJs + ']';

        if ($kind === 'get' || $kind === 'set') {
            _.js += $kind + _.space + keyJs;
            generateFunctionBody($val);
        }

        else {
            if ($expr.shorthand)
                _.js += keyJs;

            else if ($expr.method) {
                if ($val.generator)
                    keyJs = '*' + keyJs;
                else if ($val.async)
                    keyJs = 'async ' + keyJs;

                _.js += keyJs;
                generateFunctionBody($val)
            }

            else {
                _.js += keyJs + ':' + _.optSpace;
                ExprGen[$val.type]($val, Preset.e4);
            }
        }
    },

    ObjectExpression: function generateObjectExpression ($expr) {
        var $props    = $expr.properties,
            propCount = $props.length;

        if (propCount) {
            var lastPropIdx = propCount - 1,
                prevIndent  = shiftIndent();

            _.js += '{';

            for (var i = 0; i < propCount; i++) {
                var $prop    = $props[i],
                    propType = $prop.type || Syntax.Property;

                _.js += _.newline + _.indent;
                ExprGen[propType]($prop, Preset.e5);

                if (i !== lastPropIdx)
                    _.js += ',';
            }

            _.indent = prevIndent;
            _.js += _.newline + _.indent + '}';
        }

        else
            _.js += '{}';
    },

    ObjectPattern: function generateObjectPattern ($expr) {
        var $props    = $expr.properties,
            propCount = $props.length;

        if (propCount) {
            var lastPropIdx = propCount - 1,
                multiline   = false;

            if (propCount === 1)
                multiline = $props[0].value.type !== Syntax.Identifier;

            else {
                for (var i = 0; i < propCount; i++) {
                    if (!$props[i].shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }

            _.js += multiline ? ('{' + _.newline) : '{';

            var prevIndent = shiftIndent(),
                propSuffix = ',' + (multiline ? _.newline : _.optSpace);

            for (var i = 0; i < propCount; i++) {
                var $prop = $props[i];

                if (multiline)
                    _.js += _.indent;

                ExprGen[$prop.type]($prop, Preset.e5);

                if (i !== lastPropIdx)
                    _.js += propSuffix;
            }

            _.indent = prevIndent;
            _.js += multiline ? (_.newline + _.indent + '}') : '}';
        }
        else
            _.js += '{}';
    },

    ThisExpression: function generateThisExpression () {
        _.js += 'this';
    },

    Identifier: function generateIdentifier ($expr, precedence, flag) {
        _.js += $expr.name;
    },

    ImportExpression: function generateImportExpression ($expr, settings) {
        var parenthesize = Precedence.Call < settings.precedence;
        var $source      = $expr.source;

        if (parenthesize)
            _.js += '(';

        _.js += 'import(';

        ExprGen[$source.type]($source, Preset.e4);

        _.js += ')';

        if (parenthesize)
            _.js += ')';
    },

    ImportSpecifier: function generateImportSpecifier ($expr) {
        _.js += $expr.imported.name;

        if ($expr.local)
            _.js += _.space + 'as' + _.space + $expr.local.name;
    },

    ExportSpecifier: function generateImportOrExportSpecifier ($expr) {
        _.js += $expr.local.name;

        if ($expr.exported)
            _.js += _.space + 'as' + _.space + $expr.exported.name;
    },

    ChainExpression: function generateChainExpression ($expr, settings) {
        var parenthesize = Precedence.OptionalChaining < settings.precedence;
        var $expression  = $expr.expression;

        settings = settings || {};

        var newSettings  = {
            precedence: Precedence.OptionalChaining,
            allowIn:    settings.allowIn ,
            allowCall:  settings.allowCall,

            allowUnparenthesizedNew: settings.allowUnparenthesizedNew
        }

        if (parenthesize) {
            newSettings.allowCall = true;
            _.js += '(';
        }

        ExprGen[$expression.type]($expression, newSettings);

        if (parenthesize)
            _.js += ')';
    },

    Literal: function generateLiteral ($expr) {
        if (extra.raw && $expr.raw !== void 0)
            _.js += $expr.raw;

        else if ($expr.value === null)
            _.js += 'null';

        else {
            var valueType = typeof $expr.value;

            if (valueType === 'string')
                _.js += escapeString($expr.value);

            else if (valueType === 'number')
                _.js += generateNumber($expr.value);

            else if (valueType === 'boolean')
                _.js += $expr.value ? 'true' : 'false';

            else
                _.js += generateRegExp($expr.value);
        }
    },

    GeneratorExpression: generateGeneratorOrComprehensionExpression,

    ComprehensionExpression: generateGeneratorOrComprehensionExpression,

    ComprehensionBlock: function generateComprehensionBlock ($expr) {
        var $left   = $expr.left,
            leftJs  = void 0,
            rightJs = exprToJs($expr.right, Preset.e5);

        if ($left.type === Syntax.VariableDeclaration)
            leftJs = $left.kind + _.space + stmtToJs($left.declarations[0], Preset.s6);

        else
            leftJs = exprToJs($left, Preset.e10);

        leftJs = join(leftJs, $expr.of ? 'of' : 'in');

        _.js += 'for' + _.optSpace + '(' + join(leftJs, rightJs) + ')';
    },

    RestElement: function generateRestElement ($node) {
        _.js += '...' + $node.argument.name;
    },

    SpreadElement: function generateSpreadElement ($expr) {
        var $arg = $expr.argument;

        _.js += '...';
        ExprGen[$arg.type]($arg, Preset.e4);
    },

    TaggedTemplateExpression: function generateTaggedTemplateExpression ($expr, settings) {
        var $tag         = $expr.tag,
            $quasi       = $expr.quasi,
            parenthesize = Precedence.TaggedTemplate < settings.precedence;

        if (parenthesize)
            _.js += '(';

        ExprGen[$tag.type]($tag, Preset.e11(settings.allowCall));
        ExprGen[$quasi.type]($quasi, Preset.e12);

        if (parenthesize)
            _.js += ')';
    },

    TemplateElement: function generateTemplateElement ($expr) {
        //NOTE: Don't use "cooked". Since tagged template can use raw template
        // representation. So if we do so, it breaks the script semantics.
        _.js += $expr.value.raw;
    },

    TemplateLiteral: function generateTemplateLiteral ($expr) {
        var $quasis      = $expr.quasis,
            $childExprs  = $expr.expressions,
            quasiCount   = $quasis.length,
            lastQuasiIdx = quasiCount - 1;

        _.js += '`';

        for (var i = 0; i < quasiCount; ++i) {
            var $quasi = $quasis[i];

            ExprGen[$quasi.type]($quasi, Preset.e13);

            if (i !== lastQuasiIdx) {
                var $childExpr = $childExprs[i];

                _.js += '${' + _.optSpace;
                ExprGen[$childExpr.type]($childExpr, Preset.e5);
                _.js += _.optSpace + '}';
            }
        }

        _.js += '`';
    },

    Super: function generateSuper () {
        _.js += 'super';
    }
};


//-------------------------------------------------===------------------------------------------------------
//                                              Statements
//-------------------------------------------------===------------------------------------------------------


//Regular expressions
var EXPR_STMT_UNALLOWED_EXPR_REGEXP = /^{|^class(?:\s|{)|^(async )?function(?:\s|\*|\()/;


//Common statement generators
function generateTryStatementHandlers (stmtJs, $finalizer, handlers) {
    var handlerCount   = handlers.length,
        lastHandlerIdx = handlerCount - 1;

    for (var i = 0; i < handlerCount; ++i) {
        var handlerJs = stmtToJs(handlers[i], Preset.s7);

        stmtJs = join(stmtJs, handlerJs);

        if ($finalizer || i !== lastHandlerIdx)
            stmtJs += adoptionSuffix(handlers[i].body);
    }

    return stmtJs;
}

function generateForStatementIterator ($op, $stmt, settings) {
    var $body                 = $stmt.body,
        $left                 = $stmt.left,
        bodySemicolonOptional = !semicolons && settings.semicolonOptional,
        prevIndent1           = shiftIndent(),
        awaitStr              = $stmt.await ? ' await' : '',
        stmtJs                = 'for' + awaitStr + _.optSpace + '(';

    if ($left.type === Syntax.VariableDeclaration) {
        var prevIndent2 = shiftIndent();

        stmtJs += $left.kind + _.space + stmtToJs($left.declarations[0], Preset.s6);
        _.indent = prevIndent2;
    }

    else
        stmtJs += exprToJs($left, Preset.e10);

    stmtJs = join(stmtJs, $op);

    var rightJs = exprToJs($stmt.right, Preset.e4);

    stmtJs = join(stmtJs, rightJs) + ')';

    _.indent = prevIndent1;

    _.js += stmtJs + adoptionPrefix($body);
    StmtGen[$body.type]($body, Preset.s4(bodySemicolonOptional));
}


//Statement generator dictionary
var StmtRawGen = {
    BlockStatement: function generateBlockStatement ($stmt, settings) {
        var $body      = $stmt.body,
            len        = $body.length,
            lastIdx    = len - 1,
            prevIndent = shiftIndent();

        _.js += '{' + _.newline;

        for (var i = 0; i < len; i++) {
            var $item = $body[i];

            _.js += _.indent;
            StmtGen[$item.type]($item, Preset.s1(settings.functionBody, i === lastIdx));
            _.js += _.newline;
        }

        _.indent = prevIndent;
        _.js += _.indent + '}';
    },

    BreakStatement: function generateBreakStatement ($stmt, settings) {
        if ($stmt.label)
            _.js += 'break ' + $stmt.label.name;

        else
            _.js += 'break';

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    ContinueStatement: function generateContinueStatement ($stmt, settings) {
        if ($stmt.label)
            _.js += 'continue ' + $stmt.label.name;

        else
            _.js += 'continue';

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    ClassBody: function generateClassBody ($stmt) {
        var $body       = $stmt.body,
            itemCount   = $body.length,
            lastItemIdx = itemCount - 1,
            prevIndent  = shiftIndent();

        _.js += '{' + _.newline;

        for (var i = 0; i < itemCount; i++) {
            var $item    = $body[i],
                itemType = $item.type || Syntax.Property;

            _.js += _.indent;
            ExprGen[itemType]($item, Preset.e5);

            if (i !== lastItemIdx)
                _.js += _.newline;
        }

        _.indent = prevIndent;
        _.js += _.newline + _.indent + '}';
    },

    ClassDeclaration: function generateClassDeclaration ($stmt) {
        var $body  = $stmt.body,
            $super = $stmt.superClass,
            js     = 'class ' + $stmt.id.name;

        if ($super) {
            var superJs = exprToJs($super, Preset.e4);

            js += _.space + join('extends', superJs);
        }

        _.js += js + _.optSpace;
        StmtGen[$body.type]($body, Preset.s2);
    },

    DirectiveStatement: function generateDirectiveStatement ($stmt, settings) {
        if (extra.raw && $stmt.raw)
            _.js += $stmt.raw;

        else
            _.js += escapeDirective($stmt.directive);

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    DoWhileStatement: function generateDoWhileStatement ($stmt, settings) {
        var $body  = $stmt.body,
            $test  = $stmt.test,
            bodyJs = adoptionPrefix($body) +
                     stmtToJs($body, Preset.s7) +
                     adoptionSuffix($body);

        //NOTE: Because `do 42 while (cond)` is Syntax Error. We need semicolon.
        var stmtJs = join('do', bodyJs);

        _.js += join(stmtJs, 'while' + _.optSpace + '(');
        ExprGen[$test.type]($test, Preset.e5);
        _.js += ')';

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    CatchClause: function generateCatchClause ($stmt) {
        var $param     = $stmt.param,
            $guard     = $stmt.guard,
            $body      = $stmt.body,
            prevIndent = shiftIndent();

        _.js += 'catch' + _.optSpace;
        
        if ($param) {
           _.js += '(';
           ExprGen[$param.type]($param, Preset.e5);
        }

        if ($guard) {
            _.js += ' if ';
            ExprGen[$guard.type]($guard, Preset.e5);
        }

        _.indent = prevIndent;
        if ($param) {
           _.js += ')';
        } 
     
        _.js += adoptionPrefix($body);
        StmtGen[$body.type]($body, Preset.s7);
    },

    DebuggerStatement: function generateDebuggerStatement ($stmt, settings) {
        _.js += 'debugger';

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    EmptyStatement: function generateEmptyStatement () {
        _.js += ';';
    },

    ExportAllDeclaration: function ($stmt, settings) {
        StmtRawGen.ExportDeclaration($stmt, settings, true);
    },

    ExportDeclaration: function generateExportDeclaration ($stmt, settings, exportAll) {
        var $specs        = $stmt.specifiers,
            $decl         = $stmt.declaration,
            withSemicolon = semicolons || !settings.semicolonOptional;

        // export default AssignmentExpression[In] ;
        if ($stmt['default']) {
            var declJs = exprToJs($decl, Preset.e4);

            _.js += join('export default', declJs);

            if (withSemicolon)
                _.js += ';';
        }

        // export * FromClause ;
        // export ExportClause[NoReference] FromClause ;
        // export ExportClause ;
        else if ($specs || exportAll) {
            var stmtJs = 'export';

            if (exportAll)
                stmtJs += _.optSpace + '*';

            else if ($specs.length === 0)
                stmtJs += _.optSpace + '{' + _.optSpace + '}';

            else if ($specs[0].type === Syntax.ExportBatchSpecifier) {
                var specJs = exprToJs($specs[0], Preset.e5);

                stmtJs = join(stmtJs, specJs);
            }

            else {
                var prevIndent  = shiftIndent(),
                    specCount   = $specs.length,
                    lastSpecIdx = specCount - 1;

                stmtJs += _.optSpace + '{';

                for (var i = 0; i < specCount; ++i) {
                    stmtJs += _.newline + _.indent;
                    stmtJs += exprToJs($specs[i], Preset.e5);

                    if (i !== lastSpecIdx)
                        stmtJs += ',';
                }

                _.indent = prevIndent;
                stmtJs += _.newline + _.indent + '}';
            }

            if ($stmt.source) {
                _.js += join(stmtJs, 'from' + _.optSpace);
                ExprGen.Literal($stmt.source);
            }

            else
                _.js += stmtJs;

            if (withSemicolon)
                _.js += ';';
        }

        // export VariableStatement
        // export Declaration[Default]
        else if ($decl) {
            var declJs = stmtToJs($decl, Preset.s4(!withSemicolon));

            _.js += join('export', declJs);
        }
    },

    ExportNamedDeclaration: function ($stmt, settings) {
        StmtRawGen.ExportDeclaration($stmt, settings);
    },

    ExpressionStatement: function generateExpressionStatement ($stmt, settings) {
        var exprJs       = exprToJs($stmt.expression, Preset.e5),
            parenthesize = EXPR_STMT_UNALLOWED_EXPR_REGEXP.test(exprJs) ||
                           (directive &&
                            settings.directiveContext &&
                            $stmt.expression.type === Syntax.Literal &&
                            typeof $stmt.expression.value === 'string');

        //NOTE: '{', 'function', 'class' are not allowed in expression statement.
        // Therefore, they should be parenthesized.
        if (parenthesize)
            _.js += '(' + exprJs + ')';

        else
            _.js += exprJs;

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    ImportDeclaration: function generateImportDeclaration ($stmt, settings) {
        var $specs    = $stmt.specifiers,
            stmtJs    = 'import',
            specCount = $specs.length;

        //NOTE: If no ImportClause is present,
        // this should be `import ModuleSpecifier` so skip `from`
        // ModuleSpecifier is StringLiteral.
        if (specCount) {
            var hasBinding    = !!$specs[0]['default'],
                firstNamedIdx = hasBinding ? 1 : 0,
                lastSpecIdx   = specCount - 1;

            // ImportedBinding
            if (hasBinding)
                stmtJs = join(stmtJs, $specs[0].id.name);

            // NamedImports
            if (firstNamedIdx < specCount) {
                if (hasBinding)
                    stmtJs += ',';

                stmtJs += _.optSpace + '{';

                // import { ... } from "...";
                if (firstNamedIdx === lastSpecIdx)
                    stmtJs += _.optSpace + exprToJs($specs[firstNamedIdx], Preset.e5) + _.optSpace;

                else {
                    var prevIndent = shiftIndent();

                    // import {
                    //    ...,
                    //    ...,
                    // } from "...";
                    for (var i = firstNamedIdx; i < specCount; i++) {
                        stmtJs += _.newline + _.indent + exprToJs($specs[i], Preset.e5);

                        if (i !== lastSpecIdx)
                            stmtJs += ',';
                    }

                    _.indent = prevIndent;
                    stmtJs += _.newline + _.indent;
                }

                stmtJs += '}' + _.optSpace;
            }

            stmtJs = join(stmtJs, 'from')
        }

        _.js += stmtJs + _.optSpace;
        ExprGen.Literal($stmt.source);

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    VariableDeclarator: function generateVariableDeclarator ($stmt, settings) {
        var $id         = $stmt.id,
            $init       = $stmt.init,
            genSettings = Preset.e1(settings.allowIn);

        if ($init) {
            ExprGen[$id.type]($id, genSettings);
            _.js += _.optSpace + '=' + _.optSpace;
            ExprGen[$init.type]($init, genSettings);
        }

        else {
            if ($id.type === Syntax.Identifier)
                _.js += $id.name;

            else
                ExprGen[$id.type]($id, genSettings);
        }
    },

    VariableDeclaration: function generateVariableDeclaration ($stmt, settings) {
        var $decls          = $stmt.declarations,
            len             = $decls.length,
            prevIndent      = len > 1 ? shiftIndent() : _.indent,
            declGenSettings = Preset.s3(settings.allowIn);

        _.js += $stmt.kind;

        for (var i = 0; i < len; i++) {
            var $decl = $decls[i];

            _.js += i === 0 ? _.space : (',' + _.optSpace);
            StmtGen[$decl.type]($decl, declGenSettings);
        }

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';

        _.indent = prevIndent;
    },

    ThrowStatement: function generateThrowStatement ($stmt, settings) {
        var argJs = exprToJs($stmt.argument, Preset.e5);

        _.js += join('throw', argJs);

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    TryStatement: function generateTryStatement ($stmt) {
        var $block     = $stmt.block,
            $finalizer = $stmt.finalizer,
            stmtJs     = 'try' +
                         adoptionPrefix($block) +
                         stmtToJs($block, Preset.s7) +
                         adoptionSuffix($block);

        var $handlers = $stmt.handlers || $stmt.guardedHandlers;

        if ($handlers)
            stmtJs = generateTryStatementHandlers(stmtJs, $finalizer, $handlers);

        if ($stmt.handler) {
            $handlers = isArray($stmt.handler) ? $stmt.handler : [$stmt.handler];
            stmtJs    = generateTryStatementHandlers(stmtJs, $finalizer, $handlers);
        }

        if ($finalizer) {
            stmtJs = join(stmtJs, 'finally' + adoptionPrefix($finalizer));
            stmtJs += stmtToJs($finalizer, Preset.s7);
        }

        _.js += stmtJs;
    },

    SwitchStatement: function generateSwitchStatement ($stmt) {
        var $cases     = $stmt.cases,
            $discr     = $stmt.discriminant,
            prevIndent = shiftIndent();

        _.js += 'switch' + _.optSpace + '(';
        ExprGen[$discr.type]($discr, Preset.e5);
        _.js += ')' + _.optSpace + '{' + _.newline;
        _.indent = prevIndent;

        if ($cases) {
            var caseCount   = $cases.length,
                lastCaseIdx = caseCount - 1;

            for (var i = 0; i < caseCount; i++) {
                var $case = $cases[i];

                _.js += _.indent;
                StmtGen[$case.type]($case, Preset.s4(i === lastCaseIdx));
                _.js += _.newline;
            }
        }

        _.js += _.indent + '}';
    },

    SwitchCase: function generateSwitchCase ($stmt, settings) {
        var $conseqs                = $stmt.consequent,
            $firstConseq            = $conseqs[0],
            $test                   = $stmt.test,
            i                       = 0,
            conseqSemicolonOptional = !semicolons && settings.semicolonOptional,
            conseqCount             = $conseqs.length,
            lastConseqIdx           = conseqCount - 1,
            prevIndent              = shiftIndent();

        if ($test) {
            var testJs = exprToJs($test, Preset.e5);

            _.js += join('case', testJs) + ':';
        }

        else
            _.js += 'default:';


        if (conseqCount && $firstConseq.type === Syntax.BlockStatement) {
            i++;
            _.js += adoptionPrefix($firstConseq);
            StmtGen[$firstConseq.type]($firstConseq, Preset.s7);
        }

        for (; i < conseqCount; i++) {
            var $conseq           = $conseqs[i],
                semicolonOptional = i === lastConseqIdx && conseqSemicolonOptional;

            _.js += _.newline + _.indent;
            StmtGen[$conseq.type]($conseq, Preset.s4(semicolonOptional));
        }

        _.indent = prevIndent;
    },

    IfStatement: function generateIfStatement ($stmt, settings) {
        var $conseq           = $stmt.consequent,
            $test             = $stmt.test,
            prevIndent        = shiftIndent(),
            semicolonOptional = !semicolons && settings.semicolonOptional;

        _.js += 'if' + _.optSpace + '(';
        ExprGen[$test.type]($test, Preset.e5);
        _.js += ')';
        _.indent = prevIndent;
        _.js += adoptionPrefix($conseq);

        if ($stmt.alternate) {
            var conseq = stmtToJs($conseq, Preset.s7) + adoptionSuffix($conseq),
                alt    = stmtToJs($stmt.alternate, Preset.s4(semicolonOptional));

            if ($stmt.alternate.type === Syntax.IfStatement)
                alt = 'else ' + alt;

            else
                alt = join('else', adoptionPrefix($stmt.alternate) + alt);

            _.js += join(conseq, alt);
        }

        else
            StmtGen[$conseq.type]($conseq, Preset.s4(semicolonOptional));
    },

    ForStatement: function generateForStatement ($stmt, settings) {
        var $init                 = $stmt.init,
            $test                 = $stmt.test,
            $body                 = $stmt.body,
            $update               = $stmt.update,
            bodySemicolonOptional = !semicolons && settings.semicolonOptional,
            prevIndent            = shiftIndent();

        _.js += 'for' + _.optSpace + '(';

        if ($init) {
            if ($init.type === Syntax.VariableDeclaration)
                StmtGen[$init.type]($init, Preset.s6);

            else {
                ExprGen[$init.type]($init, Preset.e14);
                _.js += ';';
            }
        }

        else
            _.js += ';';

        if ($test) {
            _.js += _.optSpace;
            ExprGen[$test.type]($test, Preset.e5);
        }

        _.js += ';';

        if ($update) {
            _.js += _.optSpace;
            ExprGen[$update.type]($update, Preset.e5);
        }

        _.js += ')';
        _.indent = prevIndent;
        _.js += adoptionPrefix($body);
        StmtGen[$body.type]($body, Preset.s4(bodySemicolonOptional));
    },

    ForInStatement: function generateForInStatement ($stmt, settings) {
        generateForStatementIterator('in', $stmt, settings);
    },

    ForOfStatement: function generateForOfStatement ($stmt, settings) {
        generateForStatementIterator('of', $stmt, settings);
    },

    LabeledStatement: function generateLabeledStatement ($stmt, settings) {
        var $body                 = $stmt.body,
            bodySemicolonOptional = !semicolons && settings.semicolonOptional,
            prevIndent            = _.indent;

        _.js += $stmt.label.name + ':' + adoptionPrefix($body);

        if ($body.type !== Syntax.BlockStatement)
            prevIndent = shiftIndent();

        StmtGen[$body.type]($body, Preset.s4(bodySemicolonOptional));
        _.indent       = prevIndent;
    },

    ModuleDeclaration: function generateModuleDeclaration ($stmt, settings) {
        _.js += 'module' + _.space + $stmt.id.name + _.space + 'from' + _.optSpace;

        ExprGen.Literal($stmt.source);

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    Program: function generateProgram ($stmt) {
        var $body   = $stmt.body,
            len     = $body.length,
            lastIdx = len - 1;

        if (safeConcatenation && len > 0)
            _.js += '\n';

        for (var i = 0; i < len; i++) {
            var $item = $body[i];

            _.js += _.indent;
            StmtGen[$item.type]($item, Preset.s5(!safeConcatenation && i === lastIdx));

            if (i !== lastIdx)
                _.js += _.newline;
        }
    },

    FunctionDeclaration: function generateFunctionDeclaration ($stmt) {
        var isGenerator = !!$stmt.generator;

        if ($stmt.async)
            _.js += 'async ';

        _.js += isGenerator ? ('function*' + _.optSpace) : ('function' + _.space );
        _.js += $stmt.id.name;
        generateFunctionBody($stmt);
    },

    ReturnStatement: function generateReturnStatement ($stmt, settings) {
        var $arg = $stmt.argument;

        if ($arg) {
            var argJs = exprToJs($arg, Preset.e5);

            _.js += join('return', argJs);
        }

        else
            _.js += 'return';

        if (semicolons || !settings.semicolonOptional)
            _.js += ';';
    },

    WhileStatement: function generateWhileStatement ($stmt, settings) {
        var $body                 = $stmt.body,
            $test                 = $stmt.test,
            bodySemicolonOptional = !semicolons && settings.semicolonOptional,
            prevIndent            = shiftIndent();

        _.js += 'while' + _.optSpace + '(';
        ExprGen[$test.type]($test, Preset.e5);
        _.js += ')';
        _.indent = prevIndent;

        _.js += adoptionPrefix($body);
        StmtGen[$body.type]($body, Preset.s4(bodySemicolonOptional));
    },

    WithStatement: function generateWithStatement ($stmt, settings) {
        var $body                 = $stmt.body,
            $obj                  = $stmt.object,
            bodySemicolonOptional = !semicolons && settings.semicolonOptional,
            prevIndent            = shiftIndent();

        _.js += 'with' + _.optSpace + '(';
        ExprGen[$obj.type]($obj, Preset.e5);
        _.js += ')';
        _.indent = prevIndent;
        _.js += adoptionPrefix($body);
        StmtGen[$body.type]($body, Preset.s4(bodySemicolonOptional));
    }
};

function generateStatement ($stmt, option) {
    StmtGen[$stmt.type]($stmt, option);
}

//CodeGen
//-----------------------------------------------------------------------------------
function exprToJs ($expr, settings) {
    var savedJs = _.js;
    _.js        = '';

    ExprGen[$expr.type]($expr, settings);

    var src = _.js;
    _.js    = savedJs;

    return src;
}

function stmtToJs ($stmt, settings) {
    var savedJs = _.js;
    _.js        = '';

    StmtGen[$stmt.type]($stmt, settings);

    var src = _.js;
    _.js    = savedJs;

    return src;
}

function run ($node) {
    _.js = '';

    if (StmtGen[$node.type])
        StmtGen[$node.type]($node, Preset.s7);

    else
        ExprGen[$node.type]($node, Preset.e19);

    return _.js;
}

function wrapExprGen (gen) {
    return function ($expr, settings) {
        if (extra.verbatim && $expr.hasOwnProperty(extra.verbatim))
            generateVerbatim($expr, settings);

        else
            gen($expr, settings);
    }
}

function createExprGenWithExtras () {
    var gens = {};

    for (var key in ExprRawGen) {
        if (ExprRawGen.hasOwnProperty(key))
            gens[key] = wrapExprGen(ExprRawGen[key]);
    }

    return gens;
}


//Strings
var _ = {
    js:         '',
    newline:    '\n',
    optSpace:   ' ',
    space:      ' ',
    indentUnit: '    ',
    indent:     ''
};


//Generators
var ExprGen = void 0,
    StmtGen = StmtRawGen;


exports.generate = function ($node, options) {
    var defaultOptions = getDefaultOptions(), result, pair;

    if (options != null) {
        //NOTE: Obsolete options
        //
        //   `options.indent`
        //   `options.base`
        //
        // Instead of them, we can use `option.format.indent`.
        if (typeof options.indent === 'string') {
            defaultOptions.format.indent.style = options.indent;
        }
        if (typeof options.base === 'number') {
            defaultOptions.format.indent.base = options.base;
        }
        options      = updateDeeply(defaultOptions, options);
        _.indentUnit = options.format.indent.style;
        if (typeof options.base === 'string') {
            _.indent = options.base;
        }
        else {
            _.indent = stringRepeat(_.indentUnit, options.format.indent.base);
        }
    }
    else {
        options      = defaultOptions;
        _.indentUnit = options.format.indent.style;
        _.indent     = stringRepeat(_.indentUnit, options.format.indent.base);
    }
    json        = options.format.json;
    renumber    = options.format.renumber;
    hexadecimal = json ? false : options.format.hexadecimal;
    quotes      = json ? 'double' : options.format.quotes;
    escapeless  = options.format.escapeless;

    _.newline  = options.format.newline;
    _.optSpace = options.format.space;

    if (options.format.compact)
        _.newline = _.optSpace = _.indentUnit = _.indent = '';

    _.space           = _.optSpace ? _.optSpace : ' ';
    parentheses       = options.format.parentheses;
    semicolons        = options.format.semicolons;
    safeConcatenation = options.format.safeConcatenation;
    directive         = options.directive;
    parse             = json ? null : options.parse;
    extra             = options;

    if (extra.verbatim)
        ExprGen = createExprGenWithExtras();

    else
        ExprGen = ExprRawGen;

    return run($node);
};

},{}],"estree-walker":[function(require,module,exports){
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory(global.estreeWalker = {}));
}(this, (function (exports) { 'use strict';

	// @ts-check
	/** @typedef { import('estree').BaseNode} BaseNode */

	/** @typedef {{
		skip: () => void;
		remove: () => void;
		replace: (node: BaseNode) => void;
	}} WalkerContext */

	class WalkerBase {
		constructor() {
			/** @type {boolean} */
			this.should_skip = false;

			/** @type {boolean} */
			this.should_remove = false;

			/** @type {BaseNode | null} */
			this.replacement = null;

			/** @type {WalkerContext} */
			this.context = {
				skip: () => (this.should_skip = true),
				remove: () => (this.should_remove = true),
				replace: (node) => (this.replacement = node)
			};
		}

		/**
		 *
		 * @param {any} parent
		 * @param {string} prop
		 * @param {number} index
		 * @param {BaseNode} node
		 */
		replace(parent, prop, index, node) {
			if (parent) {
				if (index !== null) {
					parent[prop][index] = node;
				} else {
					parent[prop] = node;
				}
			}
		}

		/**
		 *
		 * @param {any} parent
		 * @param {string} prop
		 * @param {number} index
		 */
		remove(parent, prop, index) {
			if (parent) {
				if (index !== null) {
					parent[prop].splice(index, 1);
				} else {
					delete parent[prop];
				}
			}
		}
	}

	// @ts-check

	/** @typedef { import('estree').BaseNode} BaseNode */
	/** @typedef { import('./walker.js').WalkerContext} WalkerContext */

	/** @typedef {(
	 *    this: WalkerContext,
	 *    node: BaseNode,
	 *    parent: BaseNode,
	 *    key: string,
	 *    index: number
	 * ) => void} SyncHandler */

	class SyncWalker extends WalkerBase {
		/**
		 *
		 * @param {SyncHandler} enter
		 * @param {SyncHandler} leave
		 */
		constructor(enter, leave) {
			super();

			/** @type {SyncHandler} */
			this.enter = enter;

			/** @type {SyncHandler} */
			this.leave = leave;
		}

		/**
		 *
		 * @param {BaseNode} node
		 * @param {BaseNode} parent
		 * @param {string} [prop]
		 * @param {number} [index]
		 * @returns {BaseNode}
		 */
		visit(node, parent, prop, index) {
			if (node) {
				if (this.enter) {
					const _should_skip = this.should_skip;
					const _should_remove = this.should_remove;
					const _replacement = this.replacement;
					this.should_skip = false;
					this.should_remove = false;
					this.replacement = null;

					this.enter.call(this.context, node, parent, prop, index);

					if (this.replacement) {
						node = this.replacement;
						this.replace(parent, prop, index, node);
					}

					if (this.should_remove) {
						this.remove(parent, prop, index);
					}

					const skipped = this.should_skip;
					const removed = this.should_remove;

					this.should_skip = _should_skip;
					this.should_remove = _should_remove;
					this.replacement = _replacement;

					if (skipped) return node;
					if (removed) return null;
				}

				for (const key in node) {
					const value = node[key];

					if (typeof value !== "object") {
						continue;
					} else if (Array.isArray(value)) {
						for (let i = 0; i < value.length; i += 1) {
							if (value[i] !== null && typeof value[i].type === 'string') {
								if (!this.visit(value[i], node, key, i)) {
									// removed
									i--;
								}
							}
						}
					} else if (value !== null && typeof value.type === "string") {
						this.visit(value, node, key, null);
					}
				}

				if (this.leave) {
					const _replacement = this.replacement;
					const _should_remove = this.should_remove;
					this.replacement = null;
					this.should_remove = false;

					this.leave.call(this.context, node, parent, prop, index);

					if (this.replacement) {
						node = this.replacement;
						this.replace(parent, prop, index, node);
					}

					if (this.should_remove) {
						this.remove(parent, prop, index);
					}

					const removed = this.should_remove;

					this.replacement = _replacement;
					this.should_remove = _should_remove;

					if (removed) return null;
				}
			}

			return node;
		}
	}

	// @ts-check

	/** @typedef { import('estree').BaseNode} BaseNode */
	/** @typedef { import('./walker').WalkerContext} WalkerContext */

	/** @typedef {(
	 *    this: WalkerContext,
	 *    node: BaseNode,
	 *    parent: BaseNode,
	 *    key: string,
	 *    index: number
	 * ) => Promise<void>} AsyncHandler */

	class AsyncWalker extends WalkerBase {
		/**
		 *
		 * @param {AsyncHandler} enter
		 * @param {AsyncHandler} leave
		 */
		constructor(enter, leave) {
			super();

			/** @type {AsyncHandler} */
			this.enter = enter;

			/** @type {AsyncHandler} */
			this.leave = leave;
		}

		/**
		 *
		 * @param {BaseNode} node
		 * @param {BaseNode} parent
		 * @param {string} [prop]
		 * @param {number} [index]
		 * @returns {Promise<BaseNode>}
		 */
		async visit(node, parent, prop, index) {
			if (node) {
				if (this.enter) {
					const _should_skip = this.should_skip;
					const _should_remove = this.should_remove;
					const _replacement = this.replacement;
					this.should_skip = false;
					this.should_remove = false;
					this.replacement = null;

					await this.enter.call(this.context, node, parent, prop, index);

					if (this.replacement) {
						node = this.replacement;
						this.replace(parent, prop, index, node);
					}

					if (this.should_remove) {
						this.remove(parent, prop, index);
					}

					const skipped = this.should_skip;
					const removed = this.should_remove;

					this.should_skip = _should_skip;
					this.should_remove = _should_remove;
					this.replacement = _replacement;

					if (skipped) return node;
					if (removed) return null;
				}

				for (const key in node) {
					const value = node[key];

					if (typeof value !== "object") {
						continue;
					} else if (Array.isArray(value)) {
						for (let i = 0; i < value.length; i += 1) {
							if (value[i] !== null && typeof value[i].type === 'string') {
								if (!(await this.visit(value[i], node, key, i))) {
									// removed
									i--;
								}
							}
						}
					} else if (value !== null && typeof value.type === "string") {
						await this.visit(value, node, key, null);
					}
				}

				if (this.leave) {
					const _replacement = this.replacement;
					const _should_remove = this.should_remove;
					this.replacement = null;
					this.should_remove = false;

					await this.leave.call(this.context, node, parent, prop, index);

					if (this.replacement) {
						node = this.replacement;
						this.replace(parent, prop, index, node);
					}

					if (this.should_remove) {
						this.remove(parent, prop, index);
					}

					const removed = this.should_remove;

					this.replacement = _replacement;
					this.should_remove = _should_remove;

					if (removed) return null;
				}
			}

			return node;
		}
	}

	// @ts-check

	/** @typedef { import('estree').BaseNode} BaseNode */
	/** @typedef { import('./sync.js').SyncHandler} SyncHandler */
	/** @typedef { import('./async.js').AsyncHandler} AsyncHandler */

	/**
	 *
	 * @param {BaseNode} ast
	 * @param {{
	 *   enter?: SyncHandler
	 *   leave?: SyncHandler
	 * }} walker
	 * @returns {BaseNode}
	 */
	function walk(ast, { enter, leave }) {
		const instance = new SyncWalker(enter, leave);
		return instance.visit(ast, null);
	}

	/**
	 *
	 * @param {BaseNode} ast
	 * @param {{
	 *   enter?: AsyncHandler
	 *   leave?: AsyncHandler
	 * }} walker
	 * @returns {Promise<BaseNode>}
	 */
	async function asyncWalk(ast, { enter, leave }) {
		const instance = new AsyncWalker(enter, leave);
		return await instance.visit(ast, null);
	}

	exports.asyncWalk = asyncWalk;
	exports.walk = walk;

	Object.defineProperty(exports, '__esModule', { value: true });

})));

},{}]},{},[]);

module.exports = {
	walk: require('estree-walker').walk,
	parse: require('acorn-hammerhead').parse,
	string: require('esotope-hammerhead').generate,
}