!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.Minimart=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
var Minimart = _dereq_("./minimart.js");
var util = _dereq_("./util.js");
var World = Minimart.World;
var Route = Minimart.Route;

Actor._chunks = null;

function Actor(bootfn) {
  return {
    boot: function () {
      delete this.boot;
      var oldChunks = Actor._chunks;
      try {
	Actor._chunks = [];
	bootfn.call(this);
	var initialGestalt = finalizeActor(this, Actor._chunks);
	Actor._chunks = oldChunks;
	return [initialGestalt];
      } catch (e) {
	Actor._chunks = oldChunks;
	throw e;
      }
    }
  };
}

function checkChunks(type) {
    if (!Actor._chunks) {
	throw new Error("Call to Actor."+type+" outside of Actor constructor");
    }
}

function extractChunk(type, kind, defaultOptions, args) {
    var rawProjectionFn = args[0]
    var options = null;
    var handler = null;
    if (typeof rawProjectionFn !== 'function') {
	throw new Error("Actor."+type+" expects a function producing a pattern as first argument");
    }
    for (var i = 1; i < args.length; i++) { // NB: skip the first arg - it's rawProjectionFn
	if (typeof args[i] === 'function') {
	    if (handler !== null) { throw new Error("Too many handler functions in Actor."+type); }
	    handler = args[i];
	} else if (typeof args[i] === 'object') {
	    if (options !== null) { throw new Error("Too many options arguments in Actor."+type); }
	    options = args[i];
	} else {
	    throw new Error("Unrecognised argument in Actor."+type);
	}
    }
    options = options || {};
    for (var k in options) {
	if (!(k in defaultOptions)) {
	    throw new Error("Unrecognised option '"+k+"' in Actor."+type);
	}
    }
    for (var k in defaultOptions) {
	if (!(k in options)) {
	    options[k] = defaultOptions[k];
	}
    }
    return {
	type: type,
	kind: kind,
	rawProjectionFn: rawProjectionFn,
	options: options,
	handler: handler
    };
}

function recordChunk(chunk) {
    Actor._chunks.push(chunk);
}

function chunkExtractor(type, kind, defaultOptions) {
    return function (/* ... */) {
	checkChunks(type);
	recordChunk(extractChunk(type,
				 kind,
				 defaultOptions,
				 Array.prototype.slice.call(arguments)));
    };
}

var participantDefaults = {
    metaLevel: 0,
    when: function () { return true; }
};

var observerDefaults = {
    metaLevel: 0,
    level: 0,
    when: function () { return true; },
    presence: null,
    name: null,
    singleton: null,
    set: null,
    added: null,
    removed: null
};

Actor.advertise = chunkExtractor('advertise', 'participant', participantDefaults);
Actor.subscribe = chunkExtractor('subscribe', 'participant', participantDefaults);

Actor.observeAdvertisers = chunkExtractor('observeAdvertisers', 'observer', observerDefaults);
Actor.observeSubscribers = chunkExtractor('observeSubscribers', 'observer', observerDefaults);

Actor.observeGestalt = function (gestaltFn, eventHandlerFn) {
    checkChunks('observeGestalt');
    recordChunk({
	type: 'observeGestalt',
	kind: 'raw',
	gestaltFn: gestaltFn,
	options: {
	    when: function () { return true; }
	},
	eventHandlerFn: eventHandlerFn
    });
};

function finalizeActor(behavior, chunks) {
    var oldHandleEvent = behavior.handleEvent;
    var projections = {};
    var compiledProjections = {};
    var previousObjs = {};

    behavior._computeRoutes = function () {
	var newRoutes = Route.emptyGestalt;
	for (var i = 0; i < chunks.length; i++) {
	    var chunk = chunks[i];
	    if (chunk.options.when.call(this)) {
		switch (chunk.kind) {
		case 'raw':
		    newRoutes = newRoutes.union(chunk.gestaltFn.call(this));
		    break;
		case 'participant':
		    var proj = chunk.rawProjectionFn.call(this);
		    projections[i] = proj;
		    var g = Route.simpleGestalt(chunk.type === 'advertise',
						Route.projectionToPattern(proj),
						chunk.options.metaLevel,
						0);
		    newRoutes = newRoutes.union(g);
		    break;
		case 'observer':
		    var proj = chunk.rawProjectionFn.call(this);
		    projections[i] = proj;
		    compiledProjections[i] = Route.compileProjection(proj);
		    var g = Route.simpleGestalt(chunk.type === 'observeSubscribers',
						Route.projectionToPattern(proj),
						chunk.options.metaLevel,
						chunk.options.level + 1);
		    newRoutes = newRoutes.union(g);
		    if (chunk.options.added || chunk.options.removed) {
			previousObjs[i] = Route.arrayToSet([]);
		    }
		    break;
		default:
		    throw new Error("Unsupported chunk type/kind: "+chunk.type+"/"+chunk.kind);
		}
	    }
	}
        return newRoutes;
    };

    behavior.updateRoutes = function () {
        World.updateRoutes([this._computeRoutes()]);
    };

    behavior.handleEvent = function (e) {
	if (oldHandleEvent) { oldHandleEvent.call(this, e); }
	for (var i = 0; i < chunks.length; i++) {
	    var chunk = chunks[i];
	    switch (chunk.kind) {
	    case 'raw':
		chunk.eventHandlerFn.call(this, e);
		break;
	    case 'participant':
		if (chunk.handler
		    && (e.type === 'message')
		    && (e.metaLevel === chunk.options.metaLevel)
		    && (e.isFeedback === (chunk.type === 'advertise')))
		{
		    var matchResult = Route.matchPattern(e.message, projections[i]);
		    if (matchResult) {
			util.kwApply(chunk.handler, this, matchResult);
		    }
		}
		break;
	    case 'observer':
		if (e.type === 'routes') {
		    var projectionResult = e.gestalt.project(compiledProjections[i],
							     chunk.type !== 'observeSubscribers',
							     chunk.options.metaLevel,
							     chunk.options.level);

		    var isPresent = !Route.is_emptyMatcher(projectionResult);
		    if (chunk.options.presence) {
			this[chunk.options.presence] = isPresent;
		    }

		    var objs = [];
		    if (isPresent) {
			var keys = Route.matcherKeys(projectionResult);
			if (keys === null) {
			    console.warn("Wildcard detected while projecting ("
					 +JSON.stringify(chunk.options)+")");
			} else {
			    objs = Route.matcherKeysToObjects(keys, compiledProjections[i]);
			    if (chunk.options.set) {
				for (var j = 0; j < objs.length; j++) {
				    objs[j] = chunk.options.set.call(this, objs[j]);
				}
			    }
			}
		    }
		    if (chunk.options.name) {
			this[chunk.options.name] = objs;
		    }
		    if (chunk.options.singleton) {
			this[chunk.options.singleton] = objs.length === 1 ? objs[0] : undefined;
		    }

		    if (chunk.options.added || chunk.options.removed) {
			var objSet = Route.arrayToSet(objs);

			if (chunk.options.added) {
			    this[chunk.options.added] =
				Route.setToArray(Route.setSubtract(objSet, previousObjs[i]));
			}

			if (chunk.options.removed) {
			    this[chunk.options.removed] =
				Route.setToArray(Route.setSubtract(previousObjs[i], objSet));
			}

			previousObjs[i] = objSet;
		    }

		    if (chunk.handler) {
			chunk.handler.call(this);
		    }
		}
		break;
	    default:
		throw new Error("Unsupported chunk type/kind: "+chunk.type+"/"+chunk.kind);
	    }
	}
    };

    if (behavior.boot) { behavior.boot(); }
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      if (chunk.kind === 'observer') {
	if (chunk.options.presence) { behavior[chunk.options.presence] = false; }
	if (chunk.options.name) { behavior[chunk.options.name] = []; }
	if (chunk.options.singleton) { behavior[chunk.options.singleton] = undefined; }
	if (chunk.options.added) { behavior[chunk.options.added] = []; }
	if (chunk.options.removed) { behavior[chunk.options.removed] = []; }
      }
    }

    return behavior._computeRoutes();
}

///////////////////////////////////////////////////////////////////////////

module.exports.Actor = Actor;

},{"./minimart.js":7,"./util.js":12}],2:[function(_dereq_,module,exports){
// Wire protocol representation of events and actions

var Route = _dereq_("./route.js");

function _encode(e) {
    switch (e.type) {
    case "routes":
	return ["routes", e.gestalt.serialize(function (v) { return true; })];
    case "message":
	return ["message", e.message, e.metaLevel, e.isFeedback];
    }
}

function _decode(what) {
  return function (j) {
    switch (j[0]) {
    case "routes":
      return Minimart.updateRoutes([
	Route.deserializeGestalt(j[1], function (v) { return true; })]);
    case "message":
      return Minimart.sendMessage(j[1], j[2], j[3]);
    default:
      throw { message: "Invalid JSON-encoded " + what + ": " + JSON.stringify(j) };
    }
  };
}

///////////////////////////////////////////////////////////////////////////

module.exports.encodeEvent = _encode;
module.exports.decodeEvent = _decode("event");
module.exports.encodeAction = _encode;
module.exports.decodeAction = _decode("action");

},{"./route.js":9}],3:[function(_dereq_,module,exports){
// DOM fragment display driver
var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;
var _$ = Minimart._$;

function spawnDOMDriver(domWrapFunction, jQueryWrapFunction) {
    domWrapFunction = domWrapFunction || defaultWrapFunction;
    var d = new Minimart.DemandMatcher(domWrapFunction(_$, _$, _$));
    d.onDemandIncrease = function (captures) {
	var selector = captures[0];
	var fragmentClass = captures[1];
	var fragmentSpec = captures[2];
	World.spawn(new DOMFragment(selector,
				    fragmentClass,
				    fragmentSpec,
				    domWrapFunction,
				    jQueryWrapFunction));
    };
    World.spawn(d);
}

function defaultWrapFunction(selector, fragmentClass, fragmentSpec) {
    return ["DOM", selector, fragmentClass, fragmentSpec];
}

function DOMFragment(selector, fragmentClass, fragmentSpec, domWrapFunction, jQueryWrapFunction) {
    this.selector = selector;
    this.fragmentClass = fragmentClass;
    this.fragmentSpec = fragmentSpec;
    this.domWrapFunction = domWrapFunction;
    this.jQueryWrapFunction = jQueryWrapFunction;
    this.nodes = this.buildNodes();
}

DOMFragment.prototype.boot = function () {
    var self = this;
    var monitoring =
	sub(self.domWrapFunction(self.selector, self.fragmentClass, self.fragmentSpec), 1, 2);

    World.spawn(new World(function () {
	Minimart.JQuery.spawnJQueryDriver(self.selector+" > ."+self.fragmentClass,
					  1,
					  self.jQueryWrapFunction);
	World.spawn({
	    boot: function () { return [monitoring] },
	    handleEvent: function (e) {
		if (e.type === "routes") {
		    var level = e.gestalt.getLevel(1, 0); // find participant peers
		    if (!e.gestalt.isEmpty() && level.isEmpty()) {
			World.shutdownWorld();
		    }
		}
	    }
	});
    }));

    return [sub(self.domWrapFunction(self.selector, self.fragmentClass, self.fragmentSpec)),
	    sub(self.domWrapFunction(self.selector, self.fragmentClass, self.fragmentSpec), 0, 1)]
};

DOMFragment.prototype.handleEvent = function (e) {
    if (e.type === "routes" && e.gestalt.isEmpty()) {
	for (var i = 0; i < this.nodes.length; i++) {
	    var n = this.nodes[i];
	    n.parentNode.removeChild(n);
	}
	World.exit();
    }
};

function isAttributes(x) {
    return Array.isArray(x) && ((x.length === 0) || Array.isArray(x[0]));
}

DOMFragment.prototype.interpretSpec = function (spec) {
    // Fragment specs are roughly JSON-equivalents of SXML.
    // spec ::== ["tag", [["attr", "value"], ...], spec, spec, ...]
    //         | ["tag", spec, spec, ...]
    //         | "cdata"
    if (typeof(spec) === "string" || typeof(spec) === "number") {
	return document.createTextNode(spec);
    } else if ($.isArray(spec)) {
	var tagName = spec[0];
	var hasAttrs = isAttributes(spec[1]);
	var attrs = hasAttrs ? spec[1] : {};
	var kidIndex = hasAttrs ? 2 : 1;

	// Wow! Such XSS! Many hacks! So vulnerability! Amaze!
	var n = document.createElement(tagName);
	for (var i = 0; i < attrs.length; i++) {
	    n.setAttribute(attrs[i][0], attrs[i][1]);
	}
	for (var i = kidIndex; i < spec.length; i++) {
	    n.appendChild(this.interpretSpec(spec[i]));
	}
	return n;
    } else {
        throw new Error("Ill-formed DOM specification");
    }
};

DOMFragment.prototype.buildNodes = function () {
    var self = this;
    var nodes = [];
    $(self.selector).each(function (index, domNode) {
	var n = self.interpretSpec(self.fragmentSpec);
	n.classList.add(self.fragmentClass);
	domNode.appendChild(n);
	nodes.push(n);
    });
    return nodes;
};

///////////////////////////////////////////////////////////////////////////

module.exports.spawnDOMDriver = spawnDOMDriver;
module.exports.defaultWrapFunction = defaultWrapFunction;

},{"./minimart.js":7}],4:[function(_dereq_,module,exports){
/* Ground interface */
var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;

function Ground(bootFn) {
    var self = this;
    this.stepperId = null;
    World.withWorldStack([[this, -1]], function () {
	self.world = new World(bootFn);
    });
}

Ground.prototype.step = function () {
    var self = this;
    return World.withWorldStack([[this, -1]], function () {
	return self.world.step();
    });
};

Ground.prototype.checkPid = function (pid) {
    if (pid !== -1) console.error("Weird pid in Ground markPidRunnable", pid);
};

Ground.prototype.markPidRunnable = function (pid) {
    this.checkPid(pid);
    this.startStepping();
};

Ground.prototype.startStepping = function () {
    var self = this;
    if (this.stepperId) return;
    if (this.step()) {
	this.stepperId = setTimeout(function () {
	    self.stepperId = null;
	    self.startStepping();
	}, 0);
    }
};

Ground.prototype.stopStepping = function () {
    if (this.stepperId) {
	clearTimeout(this.stepperId);
	this.stepperId = null;
    }
};

Ground.prototype.enqueueAction = function (pid, action) {
    this.checkPid(pid);
    if (action.type === 'routes') {
	if (!action.gestalt.isEmpty()) {
	    console.error("You have subscribed to a nonexistent event source.",
			  action.gestalt.pretty());
	}
    } else {
	console.error("You have sent a message into the outer void.", action);
    }
};

///////////////////////////////////////////////////////////////////////////

module.exports.Ground = Ground;

},{"./minimart.js":7}],5:[function(_dereq_,module,exports){
// JQuery event driver
var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;
var _$ = Minimart._$;

function spawnJQueryDriver(baseSelector, metaLevel, wrapFunction) {
    metaLevel = metaLevel || 0;
    wrapFunction = wrapFunction || defaultWrapFunction;
    var d = new Minimart.DemandMatcher(wrapFunction(_$, _$, __), metaLevel,
				       {demandSideIsSubscription: true});
    d.onDemandIncrease = function (captures) {
	var selector = captures[0];
	var eventName = captures[1];
	World.spawn(new JQueryEventRouter(baseSelector,
					  selector,
					  eventName,
					  metaLevel,
					  wrapFunction));
    };
    World.spawn(d);
}

function defaultWrapFunction(selector, eventName, eventValue) {
    return ["jQuery", selector, eventName, eventValue];
}

function JQueryEventRouter(baseSelector, selector, eventName, metaLevel, wrapFunction) {
    var self = this;
    this.baseSelector = baseSelector || null;
    this.selector = selector;
    this.eventName = eventName;
    this.metaLevel = metaLevel || 0;
    this.wrapFunction = wrapFunction || defaultWrapFunction;
    this.preventDefault = (this.eventName.charAt(0) !== "+");
    this.handler =
	World.wrap(function (e) {
	    World.send(self.wrapFunction(self.selector, self.eventName, e), self.metaLevel);
	    if (self.preventDefault) e.preventDefault();
	    return !self.preventDefault;
	});
    this.computeNodes().on(this.preventDefault ? this.eventName : this.eventName.substring(1),
			   this.handler);
}

JQueryEventRouter.prototype.boot = function () {
  return [pub(this.wrapFunction(this.selector, this.eventName, __), this.metaLevel),
	  pub(this.wrapFunction(this.selector, this.eventName, __), this.metaLevel, 1)];
};

JQueryEventRouter.prototype.handleEvent = function (e) {
    if (e.type === "routes" && e.gestalt.isEmpty()) {
	this.computeNodes().off(this.eventName, this.handler);
	World.exit();
    }
};

JQueryEventRouter.prototype.computeNodes = function () {
    if (this.baseSelector) {
	return $(this.baseSelector).children(this.selector).addBack(this.selector);
    } else {
	return $(this.selector);
    }
};

function simplifyDOMEvent(e) {
    var keys = [];
    for (var k in e) {
	var v = e[k];
	if (typeof v === 'object') continue;
	if (typeof v === 'function') continue;
	keys.push(k);
    }
    keys.sort();
    var simplified = [];
    for (var i = 0; i < keys.length; i++) {
	simplified.push([keys[i], e[keys[i]]]);
    }
    return simplified;
}

///////////////////////////////////////////////////////////////////////////

module.exports.spawnJQueryDriver = spawnJQueryDriver;
module.exports.simplifyDOMEvent = simplifyDOMEvent;
module.exports.defaultWrapFunction = defaultWrapFunction;

},{"./minimart.js":7}],6:[function(_dereq_,module,exports){
module.exports = _dereq_("./minimart.js");

module.exports.DOM = _dereq_("./dom-driver.js");
module.exports.JQuery = _dereq_("./jquery-driver.js");
module.exports.RoutingTableWidget = _dereq_("./routing-table-widget.js");
module.exports.WebSocket = _dereq_("./websocket-driver.js");
module.exports.Reflect = _dereq_("./reflect.js");

module.exports.Ground = _dereq_("./ground.js").Ground;
module.exports.Actor = _dereq_("./actor.js").Actor;
module.exports.Spy = _dereq_("./spy.js").Spy;
module.exports.WakeDetector = _dereq_("./wake-detector.js").WakeDetector;

var Worker = _dereq_("./worker.js");
module.exports.Worker = Worker.Worker;
module.exports.WorkerGround = Worker.WorkerGround;

},{"./actor.js":1,"./dom-driver.js":3,"./ground.js":4,"./jquery-driver.js":5,"./minimart.js":7,"./reflect.js":8,"./routing-table-widget.js":10,"./spy.js":11,"./wake-detector.js":13,"./websocket-driver.js":14,"./worker.js":15}],7:[function(_dereq_,module,exports){
var Route = _dereq_("./route.js");
var Util = _dereq_("./util.js");

///////////////////////////////////////////////////////////////////////////

// TODO: trigger-guards as per minimart

/*---------------------------------------------------------------------------*/
/* Events and Actions */

var __ = Route.__;
var _$ = Route._$;

function sub(pattern, metaLevel, level) {
    return Route.simpleGestalt(false, pattern, metaLevel, level);
}

function pub(pattern, metaLevel, level) {
    return Route.simpleGestalt(true, pattern, metaLevel, level);
}

function spawn(behavior) {
    return { type: "spawn", behavior: behavior };
}

function updateRoutes(gestalts) {
    return { type: "routes", gestalt: Route.gestaltUnion(gestalts) };
}

function pendingRoutingUpdate(aggregate, affectedSubgestalt, knownTarget) {
    return { type: "pendingRoutingUpdate",
	     aggregate: aggregate,
	     affectedSubgestalt: affectedSubgestalt,
	     knownTarget: knownTarget };
}

function sendMessage(m, metaLevel, isFeedback) {
    return { type: "message",
	     metaLevel: (metaLevel === undefined) ? 0 : metaLevel,
	     message: m,
	     isFeedback: (isFeedback === undefined) ? false : isFeedback };
}

function shutdownWorld() {
    return { type: "shutdownWorld" };
}

/*---------------------------------------------------------------------------*/
/* Configurations */

function World(bootFn) {
    this.alive = true;
    this.eventQueue = [];
    this.runnablePids = {};
    this.partialGestalt = Route.emptyGestalt; // Only gestalt from local processes
    this.fullGestalt = Route.emptyGestalt ;; // partialGestalt unioned with downwardGestalt
    this.processTable = {};
    this.tombstones = {};
    this.downwardGestalt = Route.emptyGestalt;
    this.processActions = [];
    this.asChild(-1, bootFn, true);
}

/* Class state / methods */

World.nextPid = 0;

World.stack = [];

World.current = function () {
    return World.stack[World.stack.length - 1][0];
};

World.activePid = function () {
    return World.stack[World.stack.length - 1][1];
};

World.send = function (m, metaLevel, isFeedback) {
    World.current().enqueueAction(World.activePid(), sendMessage(m, metaLevel, isFeedback));
};

World.updateRoutes = function (gestalts) {
    World.current().enqueueAction(World.activePid(), updateRoutes(gestalts));
};

World.spawn = function (behavior) {
    World.current().enqueueAction(World.activePid(), spawn(behavior));
};

World.exit = function (exn) {
    World.current().kill(World.activePid(), exn);
};

World.shutdownWorld = function () {
    World.current().enqueueAction(World.activePid(), shutdownWorld());
};

World.withWorldStack = function (stack, f) {
    var oldStack = World.stack;
    World.stack = stack;
    var result = null;
    try {
	result = f();
    } catch (e) {
	World.stack = oldStack;
	throw e;
    }
    World.stack = oldStack;
    return result;
};

World.wrap = function (f) {
    var savedStack = World.stack.slice();
    return function () {
	var actuals = arguments;
	return World.withWorldStack(savedStack, function () {
	    var result = World.current().asChild(World.activePid(), function () {
		return f.apply(null, actuals);
	    });
	    for (var i = World.stack.length - 1; i >= 0; i--) {
		World.stack[i][0].markPidRunnable(World.stack[i][1]);
	    }
	    return result;
	});
    };
};

/* Instance methods */

World.prototype.enqueueAction = function (pid, action) {
    this.processActions.push([pid, action]);
};

// The code is written to maintain the runnablePids set carefully, to
// ensure we can locally decide whether we're inert or not without
// having to search the whole deep process tree.
World.prototype.isInert = function () {
    return this.eventQueue.length === 0
	&& this.processActions.length === 0
	&& Route.is_emptySet(this.runnablePids);
};

World.prototype.markPidRunnable = function (pid) {
    this.runnablePids[pid] = [pid];
};

World.prototype.step = function () {
    this.dispatchEvents();
    this.performActions();
    this.stepChildren();
    return this.alive && !this.isInert();
};

World.prototype.asChild = function (pid, f, omitLivenessCheck) {
    if (!(pid in this.processTable) && !omitLivenessCheck) {
	console.warn("World.asChild eliding invocation of dead process", pid);
	return;
    }

    World.stack.push([this, pid]);
    var result = null;
    try {
	result = f();
    } catch (e) {
	this.kill(pid, e);
    }
    if (World.stack.pop()[0] !== this) {
	throw new Error("Internal error: World stack imbalance");
    }
    return result;
};

World.prototype.kill = function (pid, exn) {
    if (exn && exn.stack) {
	console.log("Process exited", pid, exn, exn.stack);
    } else {
	console.log("Process exited", pid, exn);
    }
    var p = this.processTable[pid];
    delete this.processTable[pid];
    if (p) {
	if (p.behavior.trapexit) {
	  this.asChild(pid, function () { return p.behavior.trapexit(exn); }, true);
	}
	if (exn) {
	    p.exitReason = exn;
	    this.tombstones[pid] = p;
	}
	this.applyAndIssueRoutingUpdate(p.gestalt, Route.emptyGestalt);
    }
};

World.prototype.stepChildren = function () {
    var pids = this.runnablePids;
    this.runnablePids = {};
    for (var pid in pids) {
	var p = this.processTable[pid];
	if (p && p.behavior.step /* exists, haven't called it yet */) {
	    var childBusy = this.asChild(pid | 0, function () { return p.behavior.step() });
	    if (childBusy) this.markPidRunnable(pid);
	}
    }
};

World.prototype.performActions = function () {
    var queue = this.processActions;
    this.processActions = [];
    var item;
    while ((item = queue.shift()) && this.alive) {
	this.performAction(item[0], item[1]);
    }
};

World.prototype.dispatchEvents = function () {
    var queue = this.eventQueue;
    this.eventQueue = [];
    var item;
    while ((item = queue.shift())) {
	this.dispatchEvent(item);
    }
};

World.prototype.performAction = function (pid, action) {
    switch (action.type) {
    case "spawn":
	var pid = World.nextPid++;
        var entry = { gestalt: Route.emptyGestalt, behavior: action.behavior };
	this.processTable[pid] = entry;
	if (entry.behavior.boot) {
	    var initialGestalts = this.asChild(pid, function () { return entry.behavior.boot() });
	    if (initialGestalts) {
	        entry.gestalt = Route.gestaltUnion(initialGestalts).label(pid);
	    }
	    this.markPidRunnable(pid);
	}
        if (!Route.emptyGestalt.equals(entry.gestalt)) {
	    this.applyAndIssueRoutingUpdate(Route.emptyGestalt, entry.gestalt, pid);
	}
	break;
    case "routes":
	if (pid in this.processTable) {
	    // it may not be: this might be the routing update from a
	    // kill of the process
	    var oldGestalt = this.processTable[pid].gestalt;
	    var newGestalt = action.gestalt.label(pid|0);
	    // ^ pid|0: convert pid from string (table key!) to integer
	    this.processTable[pid].gestalt = newGestalt;
	    this.applyAndIssueRoutingUpdate(oldGestalt, newGestalt, pid);
	}
	break;
    case "message":
	if (action.metaLevel === 0) {
	    this.eventQueue.push(action);
	} else {
	    World.send(action.message, action.metaLevel - 1, action.isFeedback);
	}
	break;
    case "shutdownWorld":
	this.alive = false; // force us to stop doing things immediately
	World.exit();
	break;
    default:
	var exn = new Error("Action type " + action.type + " not understood");
	exn.action = action;
	throw exn;
    }
};

World.prototype.updateFullGestalt = function () {
    this.fullGestalt = this.partialGestalt.union(this.downwardGestalt);
};

World.prototype.issueLocalRoutingUpdate = function (affectedSubgestalt, knownTarget) {
    this.eventQueue.push(pendingRoutingUpdate(this.fullGestalt,
					      affectedSubgestalt,
					      knownTarget));
};

World.prototype.applyAndIssueRoutingUpdate = function (oldg, newg, knownTarget) {
    knownTarget = typeof knownTarget === 'undefined' ? null : knownTarget;
    this.partialGestalt = this.partialGestalt.erasePath(oldg).union(newg);
    this.updateFullGestalt();
    this.issueLocalRoutingUpdate(oldg.union(newg), knownTarget);
    World.updateRoutes([this.partialGestalt.drop()]);
};

World.prototype.dispatchEvent = function (e) {
    switch (e.type) {
    case "pendingRoutingUpdate":
	var pids = e.affectedSubgestalt.match(e.aggregate);
	if (e.knownTarget !== null) pids.unshift(e.knownTarget);
	for (var i = 0; i < pids.length; i++) {
	    var pid = pids[i];
	    if (pid === "out") console.warn("Would have delivered a routing update to environment");
	    var p = this.processTable[pid];
	    if (p) {
		var g = e.aggregate.filter(p.gestalt);
		this.asChild(pid, function () { p.behavior.handleEvent(updateRoutes([g])) });
		this.markPidRunnable(pid);
	    }
	}
	break;

    case "message":
	var pids = this.partialGestalt.matchValue(e.message, e.metaLevel, e.isFeedback);
	for (var i = 0; i < pids.length; i++) {
	    var pid = pids[i];
	    var p = this.processTable[pid];
	    this.asChild(pid, function () { p.behavior.handleEvent(e) });
	    this.markPidRunnable(pid);
	}
	break;

    default:
	var exn = new Error("Event type " + e.type + " not dispatchable");
	exn.event = e;
	throw exn;
    }
};

World.prototype.boot = function () {
  // Needed in order for the new World to be marked as "runnable", so
  // its initial actions get performed.
};

World.prototype.handleEvent = function (e) {
    switch (e.type) {
    case "routes":
	var oldDownward = this.downwardGestalt;
	this.downwardGestalt = e.gestalt.label("out").lift();
	this.updateFullGestalt();
	this.issueLocalRoutingUpdate(oldDownward.union(this.downwardGestalt), null);
	break;
    case "message":
	this.eventQueue.push(sendMessage(e.message, e.metaLevel + 1, e.isFeedback));
	break;
    default:
	var exn = new Error("Event type " + e.type + " not understood");
	exn.event = e;
	throw exn;
    }
};

/* Debugging, management, and monitoring */

World.prototype.processTree = function () {
    var kids = [];
    for (var pid in this.processTable) {
	var p = this.processTable[pid];
	if (p.behavior instanceof World) {
	    kids.push([pid, p.behavior.processTree()]);
	} else {
	    kids.push([pid, p]);
	}
    }
    for (var pid in this.tombstones) {
	kids.push([pid, this.tombstones[pid]]);
    }
    kids.sort(function (a, b) { return a[0] - b[0] });
    return kids;
};

World.prototype.textProcessTree = function (ownPid) {
    var lines = [];

    function dumpProcess(prefix, pid, p) {
	if (Array.isArray(p)) {
	    lines.push(prefix + '--+ ' + pid);
	    for (var i = 0; i < p.length; i++) {
		dumpProcess(prefix + '  |', p[i][0], p[i][1]);
	    }
	    lines.push(prefix);
	} else {
	    var label = p.behavior.name || p.behavior.constructor.name || '';
	    var tombstoneString = p.exitReason ? ' (EXITED: ' + p.exitReason + ') ' : '';
	    var stringifiedState;
	    try {
	      var rawState = p.behavior.debugState ? p.behavior.debugState() : p.behavior;
	      stringifiedState = JSON.stringify(rawState, function (k, v) {
		return (k === 'name') ? undefined : v;
	      });
	    } catch (e) {
	      stringifiedState = "(cannot convert process state to JSON)";
	    }
	    lines.push(prefix + '-- ' + pid + ': ' + label + tombstoneString + stringifiedState);
	}
    }

    dumpProcess('', ownPid || '', this.processTree());
    return lines.join('\n');
};

World.prototype.clearTombstones = function () {
    this.tombstones = {};
    for (var pid in this.processTable) {
	var p = this.processTable[pid];
	if (p.behavior instanceof World) {
	    p.behavior.clearTombstones();
	}
    }
};

/*---------------------------------------------------------------------------*/
/* Utilities: matching demand for some service */

function DemandMatcher(projection, metaLevel, options) {
    options = Util.extend({
	demandLevel: 0,
	supplyLevel: 0,
	demandSideIsSubscription: false,
	supplyProjection: projection
    }, options);
    this.demandPattern = Route.projectionToPattern(projection);
    this.supplyPattern = Route.projectionToPattern(options.supplyProjection);
    this.demandProjectionSpec = Route.compileProjection(projection);
    this.supplyProjectionSpec = Route.compileProjection(options.supplyProjection);
    this.metaLevel = metaLevel | 0;
    this.demandLevel = options.demandLevel;
    this.supplyLevel = options.supplyLevel;
    this.demandSideIsSubscription = options.demandSideIsSubscription;
    this.onDemandIncrease = function (captures) {
	console.error("Unhandled increase in demand for route", captures);
    };
    this.onSupplyDecrease = function (captures) {
	console.error("Unhandled decrease in supply for route", captures);
    };
    this.currentDemand = {};
    this.currentSupply = {};
}

DemandMatcher.prototype.debugState = function () {
  return {
    demandPattern: this.demandPattern,
    supplyPattern: this.supplyPattern,
    metaLevel: this.metaLevel,
    demandLevel: this.demandLevel,
    supplyLevel: this.supplyLevel,
    demandSideIsSubscription: this.demandSideIsSubscription

    // , currentDemand: this.currentDemand
    // , currentSupply: this.currentSupply
  };
};

DemandMatcher.prototype.boot = function () {
    var observerLevel = 1 + Math.max(this.demandLevel, this.supplyLevel);
    return [sub(this.demandPattern, this.metaLevel, observerLevel),
	    pub(this.supplyPattern, this.metaLevel, observerLevel)];
};

DemandMatcher.prototype.handleEvent = function (e) {
    if (e.type === "routes") {
	this.handleGestalt(e.gestalt);
    }
};

DemandMatcher.prototype.handleGestalt = function (gestalt) {
    var newDemandMatcher = gestalt.project(this.demandProjectionSpec,
					   !this.demandSideIsSubscription,
					   this.metaLevel,
					   this.demandLevel);
    var newSupplyMatcher = gestalt.project(this.supplyProjectionSpec,
					   this.demandSideIsSubscription,
					   this.metaLevel,
					   this.supplyLevel);
    var newDemand = Route.arrayToSet(Route.matcherKeys(newDemandMatcher));
    var newSupply = Route.arrayToSet(Route.matcherKeys(newSupplyMatcher));
    var demandDelta = Route.setSubtract(newDemand, this.currentDemand);
    var supplyDelta = Route.setSubtract(this.currentSupply, newSupply);
    var demandIncr = Route.setSubtract(demandDelta, newSupply);
    var supplyDecr = Route.setIntersect(supplyDelta, newDemand);
    this.currentDemand = newDemand;
    this.currentSupply = newSupply;
    for (var k in demandIncr) this.onDemandIncrease(demandIncr[k]);
    for (var k in supplyDecr) this.onSupplyDecrease(supplyDecr[k]);
};

/*---------------------------------------------------------------------------*/
/* Utilities: deduplicator */

function Deduplicator(ttl_ms) {
    this.ttl_ms = ttl_ms || 10000;
    this.queue = [];
    this.map = {};
    this.timerId = null;
}

Deduplicator.prototype.accept = function (m) {
    var s = JSON.stringify(m);
    if (s in this.map) return false;
    var entry = [(+new Date()) + this.ttl_ms, s, m];
    this.map[s] = entry;
    this.queue.push(entry);

    if (this.timerId === null) {
	var self = this;
	this.timerId = setInterval(function () { self.expireMessages(); },
				   this.ttl_ms > 1000 ? 1000 : this.ttl_ms);
    }
    return true;
};

Deduplicator.prototype.expireMessages = function () {
    var now = +new Date();
    while (this.queue.length > 0 && this.queue[0][0] <= now) {
	var entry = this.queue.shift();
	delete this.map[entry[1]];
    }
    if (this.queue.length === 0) {
	clearInterval(this.timerId);
	this.timerId = null;
    }
};

///////////////////////////////////////////////////////////////////////////

module.exports.__ = __;
module.exports._$ = _$;

module.exports.sub = sub;
module.exports.pub = pub;
module.exports.spawn = spawn;
module.exports.updateRoutes = updateRoutes;
module.exports.sendMessage = sendMessage;
module.exports.shutdownWorld = shutdownWorld;

module.exports.World = World;
module.exports.DemandMatcher = DemandMatcher;
module.exports.Deduplicator = Deduplicator;
module.exports.Route = Route;

},{"./route.js":9,"./util.js":12}],8:[function(_dereq_,module,exports){
// Reflection on function formal parameter lists.
// This module is based on Angular's "injector" code,
// https://github.com/angular/angular.js/blob/master/src/auto/injector.js,
// MIT licensed, and hence:
// Copyright (c) 2010-2014 Google, Inc. http://angularjs.org
// Copyright (c) 2014 Tony Garnock-Jones

var FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;
var FN_ARG_SPLIT = /,/;
var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

function formalParameters(fn) {
    var result = [];

    var fnText = fn.toString().replace(STRIP_COMMENTS, '');
    var argDecl = fnText.match(FN_ARGS);
    var args = argDecl[1].split(FN_ARG_SPLIT);
    for (var i = 0; i < args.length; i++) {
	var trimmed = args[i].trim();
	if (trimmed) { result.push(trimmed); }
    }

    return result;
}

module.exports.formalParameters = formalParameters;

},{}],9:[function(_dereq_,module,exports){
var __ = "__"; /* wildcard marker */

var SOA = "__["; // start of array
var EOA = "__]"; // end of array

function die(message) {
    throw new Error(message);
}

function $Embedded(matcher) {
    this.matcher = matcher;
}

function embeddedMatcher(matcher) {
    return new $Embedded(matcher);
}

// The name argument should be a string or null; it defaults to null.
// The pattern argument defaults to wildcard, __.
function $Capture(name, pattern) {
    this.name = name || null;
    this.pattern = (typeof pattern === 'undefined' ? __ : pattern);
}

// Abbreviation: _$(...) <==> new $Capture(...)
function _$(name, pattern) {
    return new $Capture(name, pattern);
}

function isCapture(x) { return x instanceof $Capture || x === _$; }
function captureName(x) { return x instanceof $Capture ? x.name : null; }
function capturePattern(x) { return x instanceof $Capture ? x.pattern : __; }

var SOC = "__{{"; // start of capture
var EOC = "__}}"; // end of capture

function $Success(value) {
    this.value = value;
}

function $WildcardSequence(matcher) {
    this.matcher = matcher;
}

function $Dict() {
    this.length = 0;
    this.entries = {};
}

$Dict.prototype.get = function (key) {
    return this.entries[key] || emptyMatcher;
};

$Dict.prototype.set = function (key, val) {
    if (!(key in this.entries)) this.length++;
    this.entries[key] = val;
};

$Dict.prototype.clear = function (key) {
    if (key in this.entries) this.length--;
    delete this.entries[key];
};

$Dict.prototype.isEmpty = function () {
    return this.length === 0;
};

$Dict.prototype.copy = function () {
    var other = new $Dict();
    other.length = this.length;
    for (var key in this.entries) {
	if (this.entries.hasOwnProperty(key)) {
	    other.entries[key] = this.entries[key];
	}
    }
    return other;
};

$Dict.prototype.emptyGuard = function () {
    if (this.isEmpty()) return emptyMatcher;
    return this;
};

$Dict.prototype.has = function (key) {
    return key in this.entries;
};

$Dict.prototype.sortedKeys = function () {
    var ks = [];
    for (var k in this.entries) ks.push(k);
    ks.sort();
    return ks;
}

function is_emptyMatcher(m) {
    return (m === emptyMatcher);
}

///////////////////////////////////////////////////////////////////////////
// Constructors

var emptyMatcher = null;

function rsuccess(v) {
    return (v === emptyMatcher) ? emptyMatcher : new $Success(v);
}

function rseq(e, r) {
    if (r === emptyMatcher) return emptyMatcher;
    var s = new $Dict();
    s.set(e, r);
    return s;
}

function rwild(r) {
    return rseq(__, r);
}

function rwildseq(r) {
    return (r === emptyMatcher) ? emptyMatcher : new $WildcardSequence(r);
}

///////////////////////////////////////////////////////////////////////////

function compilePattern(v, p) {
    if (!p) die("compilePattern: missing pattern");
    return walk(p, rseq(EOA, rsuccess(v)));

    function walk(p, acc) {
	if (p === __) return rwild(acc);

	if (Array.isArray(p)) {
	    acc = rseq(EOA, acc);
	    for (var i = p.length - 1; i >= 0; i--) {
		acc = walk(p[i], acc);
	    }
	    return rseq(SOA, acc);
	}

	if (p instanceof $Embedded) {
	    return appendMatcher(p.matcher, function (v) { return acc; });
	} else {
	    return rseq(JSON.stringify(p), acc);
	}
    }
}

function matchPattern(v, p) {
    var captureCount = 0;
    var result = {};
    try {
	walk(v, p);
    } catch (e) {
	if (e.matchPatternFailed) return null;
	throw e;
    }
    result.length = captureCount;
    return result;

    function walk(v, p) {
	if (p === v) return;

	if (p === __) return;

	if (Array.isArray(p) && Array.isArray(v) && p.length === v.length) {
	    for (var i = 0; i < p.length; i++) {
		walk(v[i], p[i]);
	    }
	    return;
	}

	if (isCapture(p)) {
	    var thisCapture = captureCount++;
	    walk(v, capturePattern(p));
	    result[captureName(p) || ('$' + thisCapture)] = v;
	    return;
	}

	if (p instanceof $Embedded) {
	    die("$Embedded patterns not supported in matchPattern()");
	}

	throw {matchPatternFailed: true};
    }
}

function shallowCopyArray(s) {
    return s.slice();
}

function rupdateInplace(r, key, k) {
    if (is_emptyMatcher(k)) {
	r.clear(key);
    } else {
	r.set(key, k);
    }
}

function matcherEquals(a, b) {
    if (a === null) {
	return (b === null);
    }
    if (b === null) return false;

    if (a instanceof $WildcardSequence) {
	if (!(b instanceof $WildcardSequence)) return false;
	a = a.matcher;
	b = b.matcher;
    } else if (b instanceof $WildcardSequence) return false;

    if (a instanceof $Success) {
	if (!(b instanceof $Success)) return false;
	return valuesEqual(a.value, b.value);
    }
    if (b instanceof $Success) return false;

    for (var key in a.entries) {
	if (!b.has(key)) return false;
	if (!matcherEquals(a.entries[key], b.entries[key])) return false;
    }
    return true;
}

function is_keyOpen(k) {
    return k === SOA;
}

function is_keyClose(k) {
    return k === EOA;
}

function is_keyNormal(k) {
    return !(is_keyOpen(k) || is_keyClose(k));
}

///////////////////////////////////////////////////////////////////////////
// Enough of sets to get by with

function arrayToSet(xs) {
    var s = {};
    for (var i = 0; i < xs.length; i++) {
	s[JSON.stringify(xs[i])] = xs[i];
    }
    return s;
}

function setToArray(s) {
    var r = [];
    for (var k in s) r.push(s[k]);
    return r;
}

function setUnion(s1, s2) {
    var s = {};
    setUnionInplace(s, s1);
    setUnionInplace(s, s2);
    return s;
}

function is_emptySet(s) {
    for (var k in s) {
	if (s.hasOwnProperty(k))
	    return false;
    }
    return true;
}

function setSubtract(s1, s2) {
    var s = {};
    for (var key in s1) {
	if (s1.hasOwnProperty(key) && !s2.hasOwnProperty(key)) {
	    s[key] = s1[key];
	}
    }
    return s;
}

function setIntersect(s1, s2) {
    var s = {};
    for (var key in s1) {
	if (s1.hasOwnProperty(key) && s2.hasOwnProperty(key)) {
	    s[key] = s1[key];
	}
    }
    return s;
}

function setUnionInplace(acc, s) {
    for (var key in s) {
	if (s.hasOwnProperty(key)) {
	    acc[key] = s[key];
	}
    }
}

function setEqual(s1, s2) {
    for (var key in s1) {
	if (s1.hasOwnProperty(key)) {
	    if (s1[key] !== s2[key]) return false;
	}
    }
    for (var key in s2) {
	if (s2.hasOwnProperty(key)) {
	    if (s1[key] !== s2[key]) return false;
	}
    }
    return true;
}

///////////////////////////////////////////////////////////////////////////

var unionSuccesses = function (v1, v2) {
    if (v1 === true) return v2;
    if (v2 === true) return v1;
    return setUnion(v1, v2);
};

var intersectSuccesses = function (v1, v2) {
    return v1;
};

var erasePathSuccesses = function (v1, v2) {
    var r = setSubtract(v1, v2);
    if (is_emptySet(r)) return null;
    return r;
};

var matchMatcherSuccesses = function (v1, v2, acc) {
    setUnionInplace(acc, v2);
};

var projectSuccess = function (v) {
    return v;
};

var valuesEqual = function (a, b) {
    return setEqual(a, b);
};

///////////////////////////////////////////////////////////////////////////

function expandWildseq(r) {
    return union(rwild(rwildseq(r)), rseq(EOA, r));
}

function union(o1, o2) {
    return merge(o1, o2);

    function merge(o1, o2) {
	if (is_emptyMatcher(o1)) return o2;
	if (is_emptyMatcher(o2)) return o1;
	return walk(o1, o2);
    }

    function walk(r1, r2) {
	if (r1 instanceof $WildcardSequence) {
	    if (r2 instanceof $WildcardSequence) {
		return rwildseq(walk(r1.matcher, r2.matcher));
	    }
	    r1 = expandWildseq(r1.matcher);
	} else if (r2 instanceof $WildcardSequence) {
	    r2 = expandWildseq(r2.matcher);
	}

	if (r1 instanceof $Success && r2 instanceof $Success) {
	    return rsuccess(unionSuccesses(r1.value, r2.value));
	}

	var w = merge(r1.get(__), r2.get(__));
	if (is_emptyMatcher(w)) {
	    var smaller = r1.length < r2.length ? r1 : r2;
	    var larger  = r1.length < r2.length ? r2 : r1;
	    var target = larger.copy();
	    for (var key in smaller.entries) {
		var k = merge(smaller.get(key), larger.get(key));
		rupdateInplace(target, key, k);
	    }
	    return target.emptyGuard();
	} else {
	    function examineKey(rA, key, rB) {
		if ((key !== __) && !target.has(key)) {
		    var k = merge(rA.get(key), rB.get(key));
		    if (is_keyOpen(key)) {
			rupdateInplace(target, key, merge(rwildseq(w), k));
		    } else if (is_keyClose(key)) {
			if (w instanceof $WildcardSequence) {
			    rupdateInplace(target, key, merge(w.matcher, k));
			} else {
			    rupdateInplace(target, key, k);
			}
		    } else {
			rupdateInplace(target, key, merge(w, k));
		    }
		}
	    }
	    var target = rwild(w).copy();
	    for (var key in r1.entries) { examineKey(r1, key, r2); }
	    for (var key in r2.entries) { examineKey(r2, key, r1); }
	    return target;
	}
    }
}

function unionN() {
    var acc = emptyMatcher;
    for (var i = 0; i < arguments.length; i++) {
	acc = union(acc, arguments[i]);
    }
    return acc;
}

function intersect(o1, o2) {
    if (is_emptyMatcher(o1)) return emptyMatcher;
    if (is_emptyMatcher(o2)) return emptyMatcher;
    return walk(o1, o2);

    function walkFlipped(r2, r1) { return walk(r1, r2); }

    function walk(r1, r2) {
	// INVARIANT: r1 is a part of the original o1, and
	// likewise for r2. This is so that the first arg to
	// intersectSuccesses always comes from r1, and the second
	// from r2.
	if (is_emptyMatcher(r1)) return emptyMatcher;
	if (is_emptyMatcher(r2)) return emptyMatcher;

	if (r1 instanceof $WildcardSequence) {
	    if (r2 instanceof $WildcardSequence) {
		return rwildseq(walk(r1.matcher, r2.matcher));
	    }
	    r1 = expandWildseq(r1.matcher);
	} else if (r2 instanceof $WildcardSequence) {
	    r2 = expandWildseq(r2.matcher);
	}

	if (r1 instanceof $Success && r2 instanceof $Success) {
	    return rsuccess(intersectSuccesses(r1.value, r2.value));
	}

	var w1 = r1.get(__);
	var w2 = r2.get(__);
	var w = walk(w1, w2);

	var target = new $Dict();

	function examineKey(key) {
	    if ((key !== __) && !target.has(key)) {
		var k1 = r1.get(key);
		var k2 = r2.get(key);
		if (is_emptyMatcher(k1)) {
		    if (is_emptyMatcher(k2)) {
			rupdateInplace(target, key, emptyMatcher);
		    } else {
			rupdateInplace(target, key, walkWild(walk, w1, key, k2));
		    }
		} else {
		    if (is_emptyMatcher(k2)) {
			rupdateInplace(target, key, walkWild(walkFlipped, w2, key, k1));
		    } else {
			rupdateInplace(target, key, walk(k1, k2));
		    }
		}
	    }
	}

	if (is_emptyMatcher(w1)) {
	    if (is_emptyMatcher(w2)) {
		for (var key in (r1.length < r2.length ? r1 : r2).entries) examineKey(key);
	    } else {
		for (var key in r1.entries) examineKey(key);
	    }
	} else {
	    if (is_emptyMatcher(w2)) {
		for (var key in r2.entries) examineKey(key);
	    } else {
		rupdateInplace(target, __, w);
		for (var key in r1.entries) examineKey(key);
		for (var key in r2.entries) examineKey(key);
	    }
	}
	return target.emptyGuard();
    }

    function walkWild(walker, w, key, k) {
	if (is_emptyMatcher(w)) return emptyMatcher;
	if (is_keyOpen(key)) return walker(rwildseq(w), k);
	if (is_keyClose(key)) {
	    if (w instanceof $WildcardSequence) return walker(w.matcher, k);
	    return emptyMatcher;
	}
	return walker(w, k);
    }
}

// Removes r2's mappings from r1. Assumes r2 has previously been
// union'd into r1. The erasePathSuccesses function should return
// null to signal "no remaining success values".
function erasePath(o1, o2) {
    return walk(o1, o2);

    function walk(r1, r2) {
	if (is_emptyMatcher(r1)) {
	    return emptyMatcher;
	} else {
	    if (is_emptyMatcher(r2)) {
		return r1;
	    }
	}

	if (r1 instanceof $WildcardSequence) {
	    if (r2 instanceof $WildcardSequence) {
		return rwildseq(walk(r1.matcher, r2.matcher));
	    }
	    r1 = expandWildseq(r1.matcher);
	} else if (r2 instanceof $WildcardSequence) {
	    r2 = expandWildseq(r2.matcher);
	}

	if (r1 instanceof $Success && r2 instanceof $Success) {
	    return rsuccess(erasePathSuccesses(r1.value, r2.value));
	}

	var w1 = r1.get(__);
	var w2 = r2.get(__);
	var w = walk(w1, w2);
	var target;

	function examineKey(key) {
	    if (key !== __) {
		var k1 = r1.get(key);
		var k2 = r2.get(key);
		var updatedK;
		if (is_emptyMatcher(k2)) {
		    updatedK = walkWild(key, k1, w2);
		} else {
		    updatedK = walk(k1, k2);
		}
		// Here we ensure a "minimal" remainder in cases
		// where after an erasure, a particular key's
		// continuation is the same as the wildcard's
		// continuation. TODO: the matcherEquals check may
		// be expensive. If so, how can it be made
		// cheaper?
		if (is_keyOpen(key)) {
		    rupdateInplace(target, key,
				   ((updatedK instanceof $WildcardSequence) &&
				    matcherEquals(updatedK.matcher, w))
				   ? emptyMatcher
				   : updatedK);
		} else if (is_keyClose(key)) {
		    // We take care of this case later, after the
		    // target is fully constructed/rebuilt.
		    rupdateInplace(target, key, updatedK);
		} else {
		    rupdateInplace(target, key,
				   (matcherEquals(updatedK, w) ? emptyMatcher : updatedK));
		}
	    }
	}

	if (is_emptyMatcher(w2)) {
	    target = r1.copy();
	    for (var key in r2.entries) examineKey(key);
	} else {
	    target = new $Dict();
	    rupdateInplace(target, __, w);
	    for (var key in r1.entries) examineKey(key);
	    for (var key in r2.entries) examineKey(key);
	}

	// Here, the target is complete. If it has only two keys,
	// one wild and one is_keyClose, and wild's continuation
	// is a $WildcardSequence and the other continuation is
	// identical to the sequence's continuation, then replace
	// the whole thing with a nested $WildcardSequence.
	// (We know w === target.get(__) from before.)
	//
	// TODO: I suspect actually this applies even if there are
	// more than two keys, so long as all their continuations
	// are identical and there's at least one is_keyClose
	// alongside a wild.
	if (target.length === 2) {
	    var finalW = target.get(__);
	    if (finalW instanceof $WildcardSequence) {
		for (var key in target.entries) {
		    if ((key !== __) && is_keyClose(key)) {
			var k = target.get(key);
			if (matcherEquals(k, finalW.matcher)) {
			    return finalW;
			}
		    }
		}
	    }
	}

	return target.emptyGuard();
    }

    function walkWild(key, k, w) {
	if (is_emptyMatcher(w)) return k;
	if (is_keyOpen(key)) return walk(k, rwildseq(w));
	if (is_keyClose(key)) {
	    if (w instanceof $WildcardSequence) return walk(k, w.matcher);
	    return k;
	}
	return walk(k, w);
    }
}

// Returns null on failed match, otherwise the appropriate success
// value contained in the matcher r.
function matchValue(r, v) {
    var failureResult = null;

    var vs = [v];
    var stack = [[]];

    while (!is_emptyMatcher(r)) {
	if (r instanceof $WildcardSequence) {
	    if (stack.length === 0) return failureResult;
	    vs = stack.pop();
	    r = r.matcher;
	    continue;
	}

	if (r instanceof $Success) {
	    if (vs.length === 0 && stack.length === 0) return r.value;
	    return failureResult;
	}

	if (vs.length === 0) {
	    if (stack.length === 0) return failureResult;
	    vs = stack.pop();
	    r = r.get(EOA);
	    continue;
	}

	var v = vs.shift();

	if (typeof v === 'string' && v.substring(0, 2) === '__') {
	    die("Cannot match special string starting with __");
	}

	if (Array.isArray(v)) {
	    if (SOA in r.entries) {
		r = r.get(SOA);
		stack.push(vs);
		vs = shallowCopyArray(v);
	    } else {
		r = r.get(__);
	    }
	} else {
	    var key;
	    try {
		key = JSON.stringify(v);
	    } catch (exn) {
		// For example, v might be cyclic, as in DOM events.
		key = null;
	    }
	    if (key in r.entries) {
		r = r.get(key);
	    } else {
		r = r.get(__);
	    }
	}
    }

    return failureResult;
}

// TODO: better name for this
function matchMatcher(o1, o2, seed) {
    var acc = typeof seed === 'undefined' ? {} : seed; // will be modified in place
    walk(o1, o2);
    return acc;

    function walkFlipped(r2, r1) { return walk(r1, r2); }

    function walk(r1, r2) {
	if (is_emptyMatcher(r1) || is_emptyMatcher(r2)) return;

	if (r1 instanceof $WildcardSequence) {
	    if (r2 instanceof $WildcardSequence) {
		walk(r1.matcher, r2.matcher);
		return;
	    }
	    r1 = expandWildseq(r1.matcher);
	} else if (r2 instanceof $WildcardSequence) {
	    r2 = expandWildseq(r2.matcher);
	}

	if (r1 instanceof $Success && r2 instanceof $Success) {
	    matchMatcherSuccesses(r1.value, r2.value, acc);
	    return;
	}

	var w1 = r1.get(__);
	var w2 = r2.get(__);
	walk(w1, w2);

	function examineKey(key) {
	    if (key !== __) {
		var k1 = r1.get(key);
		var k2 = r2.get(key);
		if (is_emptyMatcher(k1)) {
		    if (is_emptyMatcher(k2)) {
			return;
		    } else {
			walkWild(walk, w1, key, k2);
		    }
		} else {
		    if (is_emptyMatcher(k2)) {
			walkWild(walkFlipped, w2, key, k1);
		    } else {
			walk(k1, k2);
		    }
		}
	    }
	}

	// Optimize similarly to intersect().
	if (is_emptyMatcher(w1)) {
	    if (is_emptyMatcher(w2)) {
		for (var key in (r1.length < r2.length ? r1 : r2).entries) examineKey(key);
	    } else {
		for (var key in r1.entries) examineKey(key);
	    }
	} else {
	    if (is_emptyMatcher(w2)) {
		for (var key in r2.entries) examineKey(key);
	    } else {
		for (var key in r1.entries) examineKey(key);
		for (var key in r2.entries) examineKey(key);
	    }
	}
    }

    function walkWild(walker, w, key, k) {
	if (is_emptyMatcher(w)) return;
	if (is_keyOpen(key)) {
	    walker(rwildseq(w), k);
	    return;
	}
	if (is_keyClose(key)) {
	    if (w instanceof $WildcardSequence) walker(w.matcher, k);
	    return;
	}
	walker(w, k);
    }
}

function appendMatcher(m, mTailFn) {
    return walk(m);

    function walk(m) {
	if (is_emptyMatcher(m)) return emptyMatcher;
	if (m instanceof $WildcardSequence) return rwildseq(walk(m.matcher));
	if (m instanceof $Success) die("Ill-formed matcher");

	var target = new $Dict();
	for (var key in m.entries) {
	    var k = m.get(key);
	    if (is_keyClose(key) && (k instanceof $Success)) {
		target = union(target, mTailFn(k.value));
	    } else {
		rupdateInplace(target, key, walk(k));
	    }
	}
	return target.emptyGuard();
    }
}

function relabel(m, f) {
    return walk(m);

    function walk(m) {
	if (is_emptyMatcher(m)) return emptyMatcher;
	if (m instanceof $WildcardSequence) return rwildseq(walk(m.matcher));
	if (m instanceof $Success) return rsuccess(f(m.value));

	var target = new $Dict();
	for (var key in m.entries) {
	    rupdateInplace(target, key, walk(m.get(key)));
	}
	return target.emptyGuard();
    }
}

function compileProjection(/* projection, projection, ... */) {
    var names = [];
    var acc = [];
    for (var i = 0; i < arguments.length; i++) {
	walk(arguments[i]);
    }
    acc.push(EOA);
    return {names: names, spec: acc};

    function walk(p) {
	if (isCapture(p)) {
	    names.push(captureName(p));
	    acc.push(SOC);
	    walk(capturePattern(p));
	    acc.push(EOC);
	    return;
	}

	if (Array.isArray(p)) {
	    acc.push(SOA);
	    for (var i = 0; i < p.length; i++) {
		walk(p[i]);
	    }
	    acc.push(EOA);
	    return;
	}

	if (p instanceof $Embedded) {
	    die("Cannot embed matcher in projection");
	} else {
	    if (p === __) {
		acc.push(p);
	    } else {
		acc.push(JSON.stringify(p));
	    }
	}
    }
}

function projectionToPattern(p) {
    return walk(p);

    function walk(p) {
	if (isCapture(p)) return walk(capturePattern(p));

	if (Array.isArray(p)) {
	    var result = [];
	    for (var i = 0; i < p.length; i++) {
		result.push(walk(p[i]));
	    }
	    return result;
	}

	if (p instanceof $Embedded) {
	    return p.matcher;
	} else {
	    return p;
	}
    }
}

function project(m, compiledProjection) {
    var spec = compiledProjection.spec;
    return walk(false, m, 0);

    function walk(isCapturing, m, specIndex) {
	if (specIndex >= spec.length) {
	    if (isCapturing) die("Bad specification: unclosed capture");
	    if (m instanceof $Success) {
		return rseq(EOA, rsuccess(projectSuccess(m.value)));
	    } else {
		return emptyMatcher;
	    }
	}

	if (is_emptyMatcher(m)) return emptyMatcher;

	var item = spec[specIndex];
	var nextIndex = specIndex + 1;

	if (item === EOC) {
	    if (!isCapturing) die("Bad specification: unepxected EOC");
	    return walk(false, m, nextIndex);
	}

	if (item === SOC) {
	    if (isCapturing) die("Bad specification: nested capture");
	    return walk(true, m, nextIndex);
	}

	if (item === __) {
	    if (m instanceof $WildcardSequence) {
		if (isCapturing) {
		    return rwild(walk(isCapturing, m, nextIndex));
		} else {
		    return walk(isCapturing, m, nextIndex);
		}
	    }

	    if (m instanceof $Success) {
		return emptyMatcher;
	    }

	    var target;
	    if (isCapturing) {
		target = new $Dict();
		rupdateInplace(target, __, walk(isCapturing, m.get(__), nextIndex));
		for (var key in m.entries) {
		    if (key !== __) {
			var mk = m.get(key);
			if (is_keyOpen(key)) {
			    function cont(mk2) { return walk(isCapturing, mk2, nextIndex); }
			    rupdateInplace(target, key, captureNested(mk, cont));
			} else if (is_keyClose(key)) {
			    // do nothing
			} else {
			    rupdateInplace(target, key, walk(isCapturing, mk, nextIndex));
			}
		    }
		}
	    } else {
		target = walk(isCapturing, m.get(__), nextIndex);
		for (var key in m.entries) {
		    if (key !== __) {
			var mk = m.get(key);
			if (is_keyOpen(key)) {
			    function cont(mk2) { return walk(isCapturing, mk2, nextIndex); }
			    target = union(target, skipNested(mk, cont));
			} else if (is_keyClose(key)) {
			    // do nothing
			} else {
			    target = union(target, walk(isCapturing, mk, nextIndex));
			}
		    }
		}
	    }
	    return target;
	}

	var result;
	if (m instanceof $WildcardSequence) {
	    if (is_keyOpen(item)) {
		result = walk(isCapturing, rwildseq(m), nextIndex);
	    } else if (is_keyClose(item)) {
		result = walk(isCapturing, m.matcher, nextIndex);
	    } else {
		result = walk(isCapturing, m, nextIndex);
	    }
	} else if (m instanceof $Success) {
	    result = emptyMatcher;
	} else {
	    if (is_keyOpen(item)) {
		result = walk(isCapturing, rwildseq(m.get(__)), nextIndex);
	    } else if (is_keyClose(item)) {
		result = emptyMatcher;
	    } else {
		result = walk(isCapturing, m.get(__), nextIndex);
	    }
	    result = union(result, walk(isCapturing, m.get(item), nextIndex));
	}
	if (isCapturing) {
	    result = rseq(item, result);
	}
	return result;
    }

    function captureNested(m, cont) {
	if (m instanceof $WildcardSequence) {
	    return rwildseq(cont(m.matcher));
	}

	if (is_emptyMatcher(m) || (m instanceof $Success)) {
	    return emptyMatcher;
	}

	var target = new $Dict();
	rupdateInplace(target, __, captureNested(m.get(__), cont));
	for (var key in m.entries) {
	    if (key !== __) {
		var mk = m.get(key);
		if (is_keyOpen(key)) {
		    function cont2(mk2) { return captureNested(mk2, cont); }
		    rupdateInplace(target, key, captureNested(mk, cont2));
		} else if (is_keyClose(key)) {
		    rupdateInplace(target, key, cont(mk));
		} else {
		    rupdateInplace(target, key, captureNested(mk, cont));
		}
	    }
	}
	return target.emptyGuard();
    }

    function skipNested(m, cont) {
	if (m instanceof $WildcardSequence) {
	    return cont(m.matcher);
	}

	if (is_emptyMatcher(m) || (m instanceof $Success)) {
	    return emptyMatcher;
	}

	var target = skipNested(m.get(__), cont);
	for (var key in m.entries) {
	    if (key !== __) {
		var mk = m.get(key);
		if (is_keyOpen(key)) {
		    function cont2(mk2) { return skipNested(mk2, cont); }
		    target = union(target, skipNested(mk, cont2));
		} else if (is_keyClose(key)) {
		    target = union(target, cont(mk));
		} else {
		    target = union(target, skipNested(mk, cont));
		}
	    }
	}
	return target;
    }
}

function matcherKeys(m) {
    if (is_emptyMatcher(m)) return [];
    return walkSeq(m, function (vss, vsk) { return vss; });

    function walk(m, k) {
	if (m instanceof $WildcardSequence) return null;
	if (m instanceof $Success) return [];
	if (m.has(__)) return null;
	var acc = [];
	for (var key in m.entries) {
	    var mk = m.get(key);
	    var piece;
	    if (is_keyOpen(key)) {
		function seqK(vss, vsk) {
		    var acc = [];
		    for (var i = 0; i < vss.length; i++) {
			var vs = vss[i];
			acc = acc.concat(k(transformSeqs(vs, key), vsk));
		    }
		    return acc;
		}
		piece = walkSeq(mk, seqK);
	    } else if (is_keyClose(key)) {
		die("matcherKeys: internal error: unexpected key-close");
	    } else {
		piece = k(JSON.parse(key), mk);
	    }
	    if (piece == null) return null;
	    acc = acc.concat(piece);
	}
	return acc;
    }

    function walkSeq(m, k) {
	if (m instanceof $WildcardSequence) return null;
	if (m instanceof $Success) return k([], emptyMatcher); // TODO: ??
	if (m.has(__)) return null;
	var acc = [];
	for (var key in m.entries) {
	    var mk = m.get(key);
	    var piece;
	    if (is_keyClose(key)) {
		piece = k([[]], mk);
	    } else {
		function outerK(v, vk) {
		    return walkSeq(vk, innerK);
		    function innerK(vss, vsk) {
			var acc = [];
			for (var i = 0; i < vss.length; i++) {
			    var vs = shallowCopyArray(vss[i]);
			    vs.unshift(v);
			    acc.push(vs);
			}
			return k(acc, vsk);
		    }
		}
		piece = walk(rseq(key, mk), outerK);
	    }
	    if (piece == null) return null;
	    acc = acc.concat(piece);
	}
	return acc;
    }

    function transformSeqs(vs, opener) {
	if (opener === SOA) return vs;
	die("Internal error: unknown opener " + opener);
    }
}

function matcherKeysToObjects(matcherKeysResult, compiledProjection) {
    if (matcherKeysResult === null) return null;
    var result = [];
    for (var i = 0; i < matcherKeysResult.length; i++) {
	var e = matcherKeysResult[i];
	var d = {};
	for (var j = 0; j < e.length; j++) {
	    d[compiledProjection.names[j] || ('$' + j)] = e[j];
	}
	result.push(d);
    }
    return result;
}

function projectObjects(m, compiledProjection) {
    return matcherKeysToObjects(matcherKeys(project(m, compiledProjection)), compiledProjection);
}

function prettyMatcher(m, initialIndent) {
    var acc = [];
    walk(initialIndent || 0, m);
    return acc.join('');

    function walk(i, m) {
	if (is_emptyMatcher(m)) {
	    acc.push("::: no further matches possible");
	    return;
	}
	if (m instanceof $WildcardSequence) {
	    acc.push("...>");
	    walk(i + 4, m.matcher);
	    return;
	}
	if (m instanceof $Success) {
	    var vs = JSON.stringify(typeof m.value === 'object'
				    ? setToArray(m.value)
				    : m.value);
	    acc.push("{" + vs + "}");
	    return;
	}

	if (m.length === 0) {
	    acc.push(" ::: empty hash!");
	    return;
	}

	var needSep = false;
	var keys = m.sortedKeys();
	for (var keyi = 0; keyi < keys.length; keyi++) {
	    var key = keys[keyi];
	    var k = m.entries[key];
	    if (needSep) {
		acc.push("\n");
		acc.push(indentStr(i));
	    } else {
		needSep = true;
	    }
	    acc.push(" ");
	    if (key === __) key = '★';
	    if (key === SOA) key = '<';
	    if (key === EOA) key = '>';
	    acc.push(key);
	    walk(i + key.length + 1, k);
	}
    }

    function indentStr(i) {
	return new Array(i + 1).join(' '); // eww
    }
}

function serializeMatcher(m, serializeSuccess) {
    return walk(m);
    function walk(m) {
	if (is_emptyMatcher(m)) return [];
	if (m instanceof $WildcardSequence) {
	    return ["...)", walk(m.matcher)];
	}
	if (m instanceof $Success) {
	    return ["", serializeSuccess(m.value)];
	}
	var acc = [];
	for (var key in m.entries) {
	    var k = m.entries[key];
	    if (key === __) key = ["__"];
	    else if (key === SOA) key = ["("];
	    else if (key === EOA) key = [")"];
	    else key = JSON.parse(key);
	    acc.push([key, walk(k)]);
	}
	return acc;
    }
}

function deserializeMatcher(r, deserializeSuccess) {
    return walk(r);
    function walk(r) {
	if (r.length === 0) return emptyMatcher;
	if (r[0] === "...)") return rwildseq(walk(r[1]));
	if (r[0] === "") return rsuccess(deserializeSuccess(r[1]));
	var acc = new $Dict();
	for (var i = 0; i < r.length; i++) {
	    var rkey = r[i][0];
	    var rk = r[i][1];
	    var key;
	    if (Array.isArray(rkey)) {
		switch (rkey[0]) {
		case "__": key = __; break;
		case "(": key = SOA; break;
		case ")": key = EOA; break;
		default: die("Invalid serialized special key: " + rkey[0]);
		}
	    } else {
		key = JSON.stringify(rkey);
	    }
	    rupdateInplace(acc, key, walk(rk));
	}
	return acc;
    }
}

///////////////////////////////////////////////////////////////////////////
// Gestalts.
// TODO: support Infinity as a level number

function GestaltLevel(subs, advs) {
    this.subscriptions = subs;
    this.advertisements = advs;
}

GestaltLevel.prototype.isEmpty = function () {
    return is_emptyMatcher(this.subscriptions) && is_emptyMatcher(this.advertisements);
};

GestaltLevel.prototype.equals = function (other) {
    return matcherEquals(this.subscriptions, other.subscriptions)
	&& matcherEquals(this.advertisements, other.advertisements);
};

GestaltLevel.prototype.pretty = function () {
    var acc = [];
    if (!is_emptyMatcher(this.subscriptions)) {
	acc.push("  - subs:");
	acc.push(prettyMatcher(this.subscriptions, 9));
	acc.push("\n");
    }
    if (!is_emptyMatcher(this.advertisements)) {
	acc.push("  - advs:");
	acc.push(prettyMatcher(this.advertisements, 9));
	acc.push("\n");
    }
    return acc.join('');
};

function straightGestaltLevelOp(op) {
    return function (p1, p2) {
	return new GestaltLevel(op(p1.subscriptions, p2.subscriptions),
				op(p1.advertisements, p2.advertisements));
    };
};

var emptyLevel = new GestaltLevel(emptyMatcher, emptyMatcher);
var emptyMetaLevel = [];

function Gestalt(metaLevels) {
    this.metaLevels = metaLevels;
}

Gestalt.prototype.getMetaLevel = function (n) {
    return this.metaLevels[n] || emptyMetaLevel;
};

Gestalt.prototype.getLevel = function (metaLevel, level) {
    return this.getMetaLevel(metaLevel)[level] || emptyLevel;
};

Gestalt.prototype.metaLevelCount = function () { return this.metaLevels.length; };
Gestalt.prototype.levelCount = function (n) { return this.getMetaLevel(n).length; };

Gestalt.prototype.matchValue = function (body, metaLevel, isFeedback) {
    var levels = this.getMetaLevel(metaLevel);
    var pids = {};
    for (var i = 0; i < levels.length; i++) {
	var matcher = (isFeedback ? levels[i].advertisements : levels[i].subscriptions);
	setUnionInplace(pids, matchValue(matcher, body));
    }
    return setToArray(pids);
};

Gestalt.prototype.project = function (spec, getAdvertisements, metaLevel, level) {
    var l = this.getLevel(metaLevel | 0, level | 0);
    var matcher = (getAdvertisements ? l.advertisements : l.subscriptions);
    return project(matcher, spec);
};

Gestalt.prototype.drop = function () {
    var mls = shallowCopyArray(this.metaLevels);
    mls.shift();
    return new Gestalt(mls);
};

Gestalt.prototype.lift = function () {
    var mls = shallowCopyArray(this.metaLevels);
    mls.unshift(emptyMetaLevel);
    return new Gestalt(mls);
};

Gestalt.prototype.equals = function (other) {
    if (this.metaLevels.length !== other.metaLevels.length) return false;
    for (var i = 0; i < this.metaLevels.length; i++) {
	var ls1 = this.metaLevels[i];
	var ls2 = other.metaLevels[i];
	if (ls1.length !== ls2.length) return false;
	for (var j = 0; j < ls1.length; j++) {
	    var p1 = ls1[j];
	    var p2 = ls2[j];
	    if (!p1.equals(p2)) return false;
	}
    }
    return true;
};

function simpleGestalt(isAdv, pat, metaLevel, level) {
    metaLevel = metaLevel || 0;
    level = level || 0;
    var matcher = compilePattern(true, pat);
    var l = new GestaltLevel(isAdv ? emptyMatcher : matcher,
			     isAdv ? matcher : emptyMatcher);
    var levels = [l];
    while (level--) { levels.unshift(emptyLevel); }
    var metaLevels = [levels];
    while (metaLevel--) { metaLevels.unshift(emptyMetaLevel); }
    return new Gestalt(metaLevels);
}

var emptyGestalt = new Gestalt([]);

// Not quite what it says on the tin - the true fullGestalt
// wouldn't be parameterized on the number of levels and
// metalevels, but instead would be full at *all* levels and
// metalevels. Our representation leaks through into the interface
// here :-/
function fullGestalt(nMetalevels, nLevels) {
    var matcher = compilePattern(true, __);
    var l = new GestaltLevel(matcher, matcher);
    var levels = [];
    while (nLevels--) { levels.push(l); }
    var metaLevels = [];
    while (nMetalevels--) { metaLevels.push(levels); }
    return new Gestalt(metaLevels);
}

Gestalt.prototype.isEmpty = function () {
    for (var i = 0; i < this.metaLevels.length; i++) {
	var levels = this.metaLevels[i];
	for (var j = 0; j < levels.length; j++) {
	    if (!levels[j].isEmpty()) return false;
	}
    }
    return true;
};

function maybePushLevel(levels, i, level) {
    if (!level.isEmpty()) {
	while (levels.length < i) levels.push(emptyLevel);
	levels.push(level);
    }
}

function maybePushMetaLevel(metaLevels, i, metaLevel) {
    if (metaLevel.length > 0) {
	while (metaLevels.length < i) metaLevels.push(emptyMetaLevel);
	metaLevels.push(metaLevel);
    }
}

Gestalt.prototype.mapZip = function (other, lengthCombiner, f) {
    var metaLevels = [];
    var mls1 = this.metaLevels;
    var mls2 = other.metaLevels;
    var nm = lengthCombiner(mls1.length, mls2.length);
    for (var i = 0; i < nm; i++) {
	var levels = [];
	var ls1 = mls1[i] || emptyMetaLevel;
	var ls2 = mls2[i] || emptyMetaLevel;
	var nl = lengthCombiner(ls1.length, ls2.length);
	for (var j = 0; j < nl; j++) {
	    var p1 = ls1[j] || emptyLevel;
	    var p2 = ls2[j] || emptyLevel;
	    var p = f(p1, p2);
	    maybePushLevel(levels, j, p);
	}
	maybePushMetaLevel(metaLevels, i, levels);
    }
    return new Gestalt(metaLevels);
};

Gestalt.prototype.union1 = function (other) {
    return this.mapZip(other, Math.max, straightGestaltLevelOp(union));
};

function gestaltUnion(gs) {
    if (gs.length === 0) return emptyGestalt;
    var acc = gs[0];
    for (var i = 1; i < gs.length; i++) {
	acc = acc.union1(gs[i]);
    }
    return acc;
}

Gestalt.prototype.union = function () {
    return arguments.length > 0 ? this.union1(gestaltUnion(arguments)) : this;
};

// Accumulates matchers from higher-numbered levels into
// lower-numbered levels.
function telescopeLevels(levels) {
    var result = shallowCopyArray(levels);
    for (var i = result.length - 2; i >= 0; i--) {
	result[i] =
	    new GestaltLevel(union(result[i].subscriptions, result[i+1].subscriptions),
			     union(result[i].advertisements, result[i+1].advertisements));
    }
    return result;
};

Gestalt.prototype.telescoped = function () {
    var mls = [];
    for (var i = 0; i < this.metaLevels.length; i++) {
	mls.push(telescopeLevels(this.metaLevels[i]));
    }
    return new Gestalt(mls);
};

Gestalt.prototype.filter = function (perspective) {
    var metaLevels = [];
    var mls1 = this.metaLevels;
    var mls2 = perspective.metaLevels;
    var nm = Math.min(mls1.length, mls2.length);
    for (var i = 0; i < nm; i++) {
	var levels = [];
	var ls1 = mls1[i] || emptyMetaLevel;
	var ls2 = mls2[i] || emptyMetaLevel;
	var nl = Math.min(ls1.length, ls2.length - 1);
	for (var j = 0; j < nl; j++) {
	    var p1 = ls1[j] || emptyLevel;
	    var subs = emptyMatcher;
	    var advs = emptyMatcher;
	    for (var k = j + 1; k < ls2.length; k++) {
		var p2 = ls2[k] || emptyLevel;
		subs = union(subs, intersect(p1.subscriptions, p2.advertisements));
		advs = union(advs, intersect(p1.advertisements, p2.subscriptions));
	    }
	    maybePushLevel(levels, j, new GestaltLevel(subs, advs));
	}
	maybePushMetaLevel(metaLevels, i, levels);
    }
    return new Gestalt(metaLevels);
};

Gestalt.prototype.match = function (perspective) {
    var pids = {};
    var nm = Math.min(this.metaLevels.length, perspective.metaLevels.length);
    for (var i = 0; i < nm; i++) {
	var ls1 = this.metaLevels[i] || emptyMetaLevel;
	var ls2 = perspective.metaLevels[i] || emptyMetaLevel;
	var nl = Math.min(ls1.length, ls2.length - 1);
	for (var j = 0; j < nl; j++) {
	    var p1 = ls1[j] || emptyLevel;
	    for (var k = j + 1; k < ls2.length; k++) {
		var p2 = ls2[k] || emptyLevel;
		matchMatcher(p1.subscriptions, p2.advertisements, pids);
		matchMatcher(p1.advertisements, p2.subscriptions, pids);
	    }
	}
    }
    return setToArray(pids);
};

Gestalt.prototype.erasePath = function (path) {
    return this.mapZip(path, Math.max, straightGestaltLevelOp(erasePath));
};

function mapLevels(inputMetaLevels, f, emptyCheck, inputEmptyLevel, outputEmptyLevel) {
    var outputMetaLevels = [];
    for (var i = 0; i < inputMetaLevels.length; i++) {
	var ls = inputMetaLevels[i];
	var levels = [];
	for (var j = 0; j < ls.length; j++) {
	    var p = f(ls[j] || inputEmptyLevel, i, j);
	    if (!emptyCheck(p, i, j)) {
		while (levels.length < j) levels.push(outputEmptyLevel);
		levels.push(p);
	    }
	}
	if (levels.length > 0) {
	    while (outputMetaLevels.length < i) outputMetaLevels.push(emptyMetaLevel);
	    outputMetaLevels.push(levels);
	}
    }
    return outputMetaLevels;
};

Gestalt.prototype.transform = function (f) {
    return new Gestalt(mapLevels(this.metaLevels, function (p, ml, l) {
	return new GestaltLevel(f(p.subscriptions, ml, l, false),
				f(p.advertisements, ml, l, true));
    }, function (p) {
	return p.isEmpty();
    }, emptyLevel, emptyLevel));
};

Gestalt.prototype.stripLabel = function () {
    return this.transform(function (m) { return relabel(m, function (v) { return true; }); });
};

Gestalt.prototype.label = function (pid) {
    var pids = arrayToSet([pid]);
    return this.transform(function (m) { return relabel(m, function (v) { return pids; }); });
};

Gestalt.prototype.pretty = function () {
    var acc = [];
    if (this.isEmpty()) {
	acc.push("EMPTY GESTALT\n");
    } else {
	for (var i = 0; i < this.metaLevels.length; i++) {
	    var ls = this.metaLevels[i];
	    for (var j = 0; j < ls.length; j++) {
		var p = ls[j];
		if (!p.isEmpty()) {
		    acc.push("GESTALT metalevel " + i + " level " + j + ":\n");
		    acc.push(p.pretty());
		}
	    }
	}
    }
    return acc.join('');
};

Gestalt.prototype.serialize = function (serializeSuccess) {
    if (typeof serializeSuccess === 'undefined') {
	serializeSuccess = function (v) { return v === true ? true : setToArray(v); };
    }
    return ["gestalt", mapLevels(this.metaLevels, function (p) {
	return [serializeMatcher(p.subscriptions, serializeSuccess),
		serializeMatcher(p.advertisements, serializeSuccess)];
    }, function (pr) {
	return pr.length === 2 && pr[0].length === 0 && pr[1].length === 0;
    }, emptyLevel, [[],[]])];
};

function deserializeGestalt(r, deserializeSuccess) {
    if (typeof deserializeSuccess === 'undefined') {
	deserializeSuccess = function (v) { return v === true ? true : arrayToSet(v); };
    }
    if (r[0] !== "gestalt") die("Invalid gestalt serialization: " + r);
    return new Gestalt(mapLevels(r[1], function (pr) {
	return new GestaltLevel(deserializeMatcher(pr[0], deserializeSuccess),
				deserializeMatcher(pr[1], deserializeSuccess));
    }, function (p) {
	return p.isEmpty();
    }, [[],[]], emptyLevel));
}

///////////////////////////////////////////////////////////////////////////

module.exports.__ = __;
module.exports.arrayToSet = arrayToSet;
module.exports.setToArray = setToArray;
module.exports.setUnion = setUnion;
module.exports.setSubtract = setSubtract;
module.exports.setIntersect = setIntersect;
module.exports.setEqual = setEqual;
module.exports.is_emptySet = is_emptySet;
module.exports.$Capture = $Capture;
module.exports._$ = _$;
module.exports.is_emptyMatcher = is_emptyMatcher;
module.exports.emptyMatcher = emptyMatcher;
module.exports.embeddedMatcher = embeddedMatcher;
module.exports.compilePattern = compilePattern;
module.exports.matchPattern = matchPattern;
module.exports.union = unionN;
module.exports.intersect = intersect;
module.exports.erasePath = erasePath;
module.exports.matchValue = matchValue;
module.exports.matchMatcher = matchMatcher;
module.exports.appendMatcher = appendMatcher;
module.exports.relabel = relabel;
module.exports.compileProjection = compileProjection;
module.exports.projectionToPattern = projectionToPattern;
module.exports.project = project;
module.exports.matcherKeys = matcherKeys;
module.exports.matcherKeysToObjects = matcherKeysToObjects;
module.exports.projectObjects = projectObjects;
module.exports.matcherEquals = matcherEquals;
module.exports.prettyMatcher = prettyMatcher;
module.exports.serializeMatcher = serializeMatcher;
module.exports.deserializeMatcher = deserializeMatcher;

module.exports.GestaltLevel = GestaltLevel;
module.exports.Gestalt = Gestalt;
module.exports.simpleGestalt = simpleGestalt;
module.exports.emptyGestalt = emptyGestalt;
module.exports.fullGestalt = fullGestalt;
module.exports.gestaltUnion = gestaltUnion;
module.exports.deserializeGestalt = deserializeGestalt;

},{}],10:[function(_dereq_,module,exports){
var Minimart = _dereq_("./minimart.js");
var Route = Minimart.Route;
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;

function spawnRoutingTableWidget(selector, fragmentClass, domWrap, observationLevel) {
    observationLevel = observationLevel || 10;
    // ^ arbitrary: should be Infinity, when route.js supports it. TODO
    domWrap = domWrap || Minimart.DOM.defaultWrapFunction;

    World.spawn({
	boot: function () { this.updateState(); },

	state: Route.emptyGestalt.serialize(),
	nextState: Route.emptyGestalt.serialize(),
	timer: false,

	localGestalt: (sub(       domWrap(selector, fragmentClass, __), 0, 2)
		       .union(pub(domWrap(selector, fragmentClass, __), 0, 2))
		       .telescoped()),

	digestGestalt: function (g) {
	    return g.stripLabel().erasePath(this.localGestalt).serialize();
	},

	updateState: function () {
	    var elts = ["pre", Route.deserializeGestalt(this.state).pretty()];
	    World.updateRoutes([sub(__, 0, observationLevel),
				pub(__, 0, observationLevel),
				pub(domWrap(selector, fragmentClass, elts))]);
	},

	handleEvent: function (e) {
	    var self = this;
	    if (e.type === "routes") {
		self.nextState = self.digestGestalt(e.gestalt);
		if (self.timer) {
		    clearTimeout(self.timer);
		    self.timer = false;
		}
		self.timer = setTimeout(World.wrap(function () {
		    if (JSON.stringify(self.nextState) !== JSON.stringify(self.state)) {
			self.state = self.nextState;
			self.updateState();
		    }
		    self.timer = false;
		}), 50);
	    }
	}
    });

}

module.exports.spawnRoutingTableWidget = spawnRoutingTableWidget;

},{"./minimart.js":7}],11:[function(_dereq_,module,exports){
// Generic Spy
var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;

function Spy(label, useJson, observationLevel) {
    this.label = label || "SPY";
    this.observationLevel = observationLevel || 10; // arbitrary. Should be Infinity. TODO
    this.useJson = useJson;
}

Spy.prototype.boot = function () {
    return [sub(__, 0, this.observationLevel), pub(__, 0, this.observationLevel)];
};

Spy.prototype.handleEvent = function (e) {
    switch (e.type) {
    case "routes":
	console.log(this.label, "routes", e.gestalt.pretty());
	break;
    case "message":
	var messageRepr;
	try {
	    messageRepr = this.useJson ? JSON.stringify(e.message) : e.message;
	} catch (exn) {
	    messageRepr = e.message;
	}
	console.log(this.label, "message", messageRepr, e.metaLevel, e.isFeedback);
	break;
    default:
	console.log(this.label, "unknown", e);
	break;
    }
};

module.exports.Spy = Spy;

},{"./minimart.js":7}],12:[function(_dereq_,module,exports){
var Reflect = _dereq_("./reflect.js");

module.exports.extend = function (what, _with) {
  for (var prop in _with) {
    if (_with.hasOwnProperty(prop)) {
      what[prop] = _with[prop];
    }
  }
  return what;
};

module.exports.kwApply = function (f, thisArg, args) {
  var formals = Reflect.formalParameters(f);
  var actuals = []
  for (var i = 0; i < formals.length; i++) {
    var formal = formals[i];
    if (!(formal in args)) {
      throw new Error("Function parameter '"+formal+"' not present in args");
    }
    actuals.push(args[formal]);
  }
  return f.apply(thisArg, actuals);
};

},{"./reflect.js":8}],13:[function(_dereq_,module,exports){
// Wake detector - notices when something (such as
// suspension/sleeping!) has caused periodic activities to be
// interrupted, and warns others about it
// Inspired by http://blog.alexmaccaw.com/javascript-wake-event
var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;

function WakeDetector(period) {
    this.message = "wake";
    this.period = period || 10000;
    this.mostRecentTrigger = +(new Date());
    this.timerId = null;
}

WakeDetector.prototype.boot = function () {
    var self = this;
    this.timerId = setInterval(World.wrap(function () { self.trigger(); }), this.period);
    return [pub(this.message)];
};

WakeDetector.prototype.handleEvent = function (e) {};

WakeDetector.prototype.trigger = function () {
    var now = +(new Date());
    if (now - this.mostRecentTrigger > this.period * 1.5) {
	World.send(this.message);
    }
    this.mostRecentTrigger = now;
};

module.exports.WakeDetector = WakeDetector;

},{"./minimart.js":7}],14:[function(_dereq_,module,exports){
var Minimart = _dereq_("./minimart.js");
var Codec = _dereq_("./codec.js");
var Route = Minimart.Route;
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;
var _$ = Minimart._$;

///////////////////////////////////////////////////////////////////////////
// WebSocket client driver

var DEFAULT_RECONNECT_DELAY = 100;
var MAX_RECONNECT_DELAY = 30000;
var DEFAULT_IDLE_TIMEOUT = 300000; // 5 minutes
var DEFAULT_PING_INTERVAL = DEFAULT_IDLE_TIMEOUT - 10000;

function WebSocketConnection(label, wsurl, shouldReconnect) {
    this.label = label;
    this.sendsAttempted = 0;
    this.sendsTransmitted = 0;
    this.receiveCount = 0;
    this.sock = null;
    this.wsurl = wsurl;
    this.shouldReconnect = shouldReconnect ? true : false;
    this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
    this.localGestalt = Route.emptyGestalt;
    this.peerGestalt = Route.emptyGestalt;
    this.prevLocalRoutesMessage = null;
    this.prevPeerRoutesMessage = null;
    this.deduplicator = new Minimart.Deduplicator();
    this.connectionCount = 0;

    this.activityTimestamp = 0;
    this.idleTimeout = DEFAULT_IDLE_TIMEOUT;
    this.pingInterval = DEFAULT_PING_INTERVAL;
    this.idleTimer = null;
    this.pingTimer = null;
}

WebSocketConnection.prototype.debugState = function () {
  return {
    label: this.label,
    sendsAttempted: this.sendsAttempted,
    sendsTransmitted: this.sendsTransmitted,
    receiveCount: this.receiveCount,
    wsurl: this.wsurl,
    shouldReconnect: this.shouldReconnect,
    reconnectDelay: this.reconnectDelay,
    connectionCount: this.connectionCount,
    activityTimestamp: this.activityTimestamp
  };
};

WebSocketConnection.prototype.clearHeartbeatTimers = function () {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.pingTimer) { clearTimeout(this.pingTimer); this.pingTimer = null; }
};

WebSocketConnection.prototype.recordActivity = function () {
    var self = this;
    this.activityTimestamp = +(new Date());
    this.clearHeartbeatTimers();
    this.idleTimer = setTimeout(function () { self.forceclose(); },
				this.idleTimeout);
    this.pingTimer = setTimeout(function () { self.safeSend(JSON.stringify("ping")) },
				this.pingInterval);
};

WebSocketConnection.prototype.statusRoute = function (status) {
    return pub([this.label + "_state", status]);
};

WebSocketConnection.prototype.relayGestalt = function () {
    return this.statusRoute(this.isConnected() ? "connected" : "disconnected")
	.union(pub([this.label, __, __], 0, 10))
	.union(sub([this.label, __, __], 0, 10));
    // TODO: level 10 is ad-hoc; support infinity at some point in future
};

WebSocketConnection.prototype.aggregateGestalt = function () {
    var self = this;
    return this.peerGestalt.transform(function (m, metaLevel) {
	return Route.compilePattern(true,
				    [self.label, metaLevel, Route.embeddedMatcher(m)]);
    }).union(this.relayGestalt());
};

WebSocketConnection.prototype.boot = function () {
    this.reconnect();
};

WebSocketConnection.prototype.trapexit = function () {
    this.forceclose();
};

WebSocketConnection.prototype.isConnected = function () {
    return this.sock && this.sock.readyState === this.sock.OPEN;
};

WebSocketConnection.prototype.safeSend = function (m) {
    try {
	this.sendsAttempted++;
	if (this.isConnected()) {
	    this.sock.send(m);
	    this.sendsTransmitted++;
	}
    } catch (e) {
	console.warn("Trapped exn while sending", e);
    }
};

WebSocketConnection.prototype.sendLocalRoutes = function () {
    var newLocalRoutesMessage =
	JSON.stringify(Codec.encodeEvent(Minimart.updateRoutes([this.localGestalt])));
    if (this.prevLocalRoutesMessage !== newLocalRoutesMessage) {
	this.prevLocalRoutesMessage = newLocalRoutesMessage;
	this.safeSend(newLocalRoutesMessage);
    }
};

WebSocketConnection.prototype.collectMatchers = function (getAdvertisements, level, g) {
    var extractMetaLevels = Route.compileProjection([this.label, _$, __]);
    var mls = Route.matcherKeys(g.project(extractMetaLevels, getAdvertisements, 0, level));
    for (var i = 0; i < mls.length; i++) {
	var metaLevel = mls[i][0]; // only one capture in the projection
	var extractMatchers = Route.compileProjection([this.label, metaLevel, _$]);
	var m = g.project(extractMatchers, getAdvertisements, 0, level);
	this.localGestalt = this.localGestalt.union(Route.simpleGestalt(getAdvertisements,
									Route.embeddedMatcher(m),
									metaLevel,
									level));
    }
};

WebSocketConnection.prototype.handleEvent = function (e) {
    // console.log("WebSocketConnection.handleEvent", e);
    switch (e.type) {
    case "routes":
	// TODO: GROSS - erasing by pid!
	var nLevels = e.gestalt.levelCount(0);
	var relayGestalt = Route.fullGestalt(1, nLevels).label(World.activePid());
	var g = e.gestalt.erasePath(relayGestalt);
	this.localGestalt = Route.emptyGestalt;
	for (var level = 0; level < nLevels; level++) {
	    this.collectMatchers(false, level, g);
	    this.collectMatchers(true, level, g);
	}

	this.sendLocalRoutes();
	break;
    case "message":
	var m = e.message;
	if (m.length && m.length === 3 && m[0] === this.label)
	{
	    var encoded = JSON.stringify(Codec.encodeEvent(
		Minimart.sendMessage(m[2], m[1], e.isFeedback)));
	    if (this.deduplicator.accept(encoded)) {
		this.safeSend(encoded);
	    }
	}
	break;
    }
};

WebSocketConnection.prototype.forceclose = function (keepReconnectDelay) {
    if (!keepReconnectDelay) {
	this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
    }
    this.clearHeartbeatTimers();
    if (this.sock) {
	console.log("WebSocketConnection.forceclose called");
	this.sock.close();
	this.sock = null;
    }
};

WebSocketConnection.prototype.reconnect = function () {
    var self = this;
    this.forceclose(true);
    this.connectionCount++;
    this.sock = new WebSocket(this.wsurl);
    this.sock.onopen = World.wrap(function (e) { return self.onopen(e); });
    this.sock.onmessage = World.wrap(function (e) {
	self.receiveCount++;
	return self.onmessage(e);
    });
    this.sock.onclose = World.wrap(function (e) { return self.onclose(e); });
};

WebSocketConnection.prototype.onopen = function (e) {
    console.log("connected to " + this.sock.url);
    this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
    this.prevLocalRoutesMessage = null;
    this.sendLocalRoutes();
};

WebSocketConnection.prototype.onmessage = function (wse) {
    // console.log("onmessage", wse);
    this.recordActivity();

    var j = JSON.parse(wse.data);
    if (j === "ping") {
	this.safeSend(JSON.stringify("pong"));
	return;
    } else if (j === "pong") {
	return; // recordActivity already took care of our timers
    }

    var e = Codec.decodeAction(j);
    switch (e.type) {
    case "routes":
	if (this.prevPeerRoutesMessage !== wse.data) {
	    this.prevPeerRoutesMessage = wse.data;
	    this.peerGestalt = e.gestalt;
	    World.updateRoutes([this.aggregateGestalt()]);
	}
	break;
    case "message":
	if (this.deduplicator.accept(wse.data)) {
	    World.send([this.label, e.metaLevel, e.message], 0, e.isFeedback);
	}
	break;
    }
};

WebSocketConnection.prototype.onclose = function (e) {
    var self = this;
    console.log("onclose", e);

    // Update routes to give clients some indication of the discontinuity
    World.updateRoutes([this.aggregateGestalt()]);

    if (this.shouldReconnect) {
	console.log("reconnecting to " + this.wsurl + " in " + this.reconnectDelay + "ms");
	setTimeout(World.wrap(function () { self.reconnect(); }), this.reconnectDelay);
	this.reconnectDelay = this.reconnectDelay * 1.618 + (Math.random() * 1000);
	this.reconnectDelay =
	    this.reconnectDelay > MAX_RECONNECT_DELAY
	    ? MAX_RECONNECT_DELAY + (Math.random() * 1000)
	    : this.reconnectDelay;
    }
};

///////////////////////////////////////////////////////////////////////////

module.exports.WebSocketConnection = WebSocketConnection;

},{"./codec.js":2,"./minimart.js":7}],15:[function(_dereq_,module,exports){
/* Web Worker interface */
var Ground = _dereq_("./ground.js").Ground;
var Util = _dereq_("./util.js");
var Codec = _dereq_("./codec.js");

var Minimart = _dereq_("./minimart.js");
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;

var BuiltinWorker = typeof window !== 'undefined' && window.Worker;

///////////////////////////////////////////////////////////////////////////

function Worker(scriptUrl) {
  this.scriptUrl = scriptUrl;
  this.w = new BuiltinWorker(scriptUrl);
}

Worker.prototype.boot = function () {
  this.w.onmessage = World.wrap(function (e) {
    console.log("Received from worker", JSON.stringify(e.data));
    World.current().enqueueAction(World.activePid(), Codec.decodeAction(e.data));
  });
};

Worker.prototype.handleEvent = function (e) {
  console.log("Sending to worker", JSON.stringify(Codec.encodeEvent(e)));
  this.w.postMessage(Codec.encodeEvent(e));
};

///////////////////////////////////////////////////////////////////////////

function WorkerGround(bootFn) {
  var self = this;
  Ground.call(this, bootFn);
  onmessage = function (e) {
    console.log("Received from main page", JSON.stringify(e.data));
    self.world.handleEvent(Codec.decodeEvent(e.data));
    self.startStepping();
  };
}

WorkerGround.prototype = Util.extend({}, Ground.prototype);

WorkerGround.prototype.enqueueAction = function (pid, action) {
  console.log("Sending to main page", JSON.stringify(Codec.encodeAction(action)));
  postMessage(Codec.encodeAction(action));
  console.log("Sent to main page");
};

///////////////////////////////////////////////////////////////////////////

module.exports.Worker = Worker;
module.exports.WorkerGround = WorkerGround;

},{"./codec.js":2,"./ground.js":4,"./minimart.js":7,"./util.js":12}]},{},[6])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy9hY3Rvci5qcyIsIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9zcmMvY29kZWMuanMiLCIvaG9tZS90b255Zy9zcmMvanMtbWFya2V0cGxhY2Uvc3JjL2RvbS1kcml2ZXIuanMiLCIvaG9tZS90b255Zy9zcmMvanMtbWFya2V0cGxhY2Uvc3JjL2dyb3VuZC5qcyIsIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9zcmMvanF1ZXJ5LWRyaXZlci5qcyIsIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9zcmMvbWFpbi5qcyIsIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9zcmMvbWluaW1hcnQuanMiLCIvaG9tZS90b255Zy9zcmMvanMtbWFya2V0cGxhY2Uvc3JjL3JlZmxlY3QuanMiLCIvaG9tZS90b255Zy9zcmMvanMtbWFya2V0cGxhY2Uvc3JjL3JvdXRlLmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy9yb3V0aW5nLXRhYmxlLXdpZGdldC5qcyIsIi9ob21lL3RvbnlnL3NyYy9qcy1tYXJrZXRwbGFjZS9zcmMvc3B5LmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy91dGlsLmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy93YWtlLWRldGVjdG9yLmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy93ZWJzb2NrZXQtZHJpdmVyLmpzIiwiL2hvbWUvdG9ueWcvc3JjL2pzLW1hcmtldHBsYWNlL3NyYy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqakRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdlBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgTWluaW1hcnQgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcbnZhciB1dGlsID0gcmVxdWlyZShcIi4vdXRpbC5qc1wiKTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIFJvdXRlID0gTWluaW1hcnQuUm91dGU7XG5cbkFjdG9yLl9jaHVua3MgPSBudWxsO1xuXG5mdW5jdGlvbiBBY3Rvcihib290Zm4pIHtcbiAgcmV0dXJuIHtcbiAgICBib290OiBmdW5jdGlvbiAoKSB7XG4gICAgICBkZWxldGUgdGhpcy5ib290O1xuICAgICAgdmFyIG9sZENodW5rcyA9IEFjdG9yLl9jaHVua3M7XG4gICAgICB0cnkge1xuXHRBY3Rvci5fY2h1bmtzID0gW107XG5cdGJvb3Rmbi5jYWxsKHRoaXMpO1xuXHR2YXIgaW5pdGlhbEdlc3RhbHQgPSBmaW5hbGl6ZUFjdG9yKHRoaXMsIEFjdG9yLl9jaHVua3MpO1xuXHRBY3Rvci5fY2h1bmtzID0gb2xkQ2h1bmtzO1xuXHRyZXR1cm4gW2luaXRpYWxHZXN0YWx0XTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcblx0QWN0b3IuX2NodW5rcyA9IG9sZENodW5rcztcblx0dGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNoZWNrQ2h1bmtzKHR5cGUpIHtcbiAgICBpZiAoIUFjdG9yLl9jaHVua3MpIHtcblx0dGhyb3cgbmV3IEVycm9yKFwiQ2FsbCB0byBBY3Rvci5cIit0eXBlK1wiIG91dHNpZGUgb2YgQWN0b3IgY29uc3RydWN0b3JcIik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBleHRyYWN0Q2h1bmsodHlwZSwga2luZCwgZGVmYXVsdE9wdGlvbnMsIGFyZ3MpIHtcbiAgICB2YXIgcmF3UHJvamVjdGlvbkZuID0gYXJnc1swXVxuICAgIHZhciBvcHRpb25zID0gbnVsbDtcbiAgICB2YXIgaGFuZGxlciA9IG51bGw7XG4gICAgaWYgKHR5cGVvZiByYXdQcm9qZWN0aW9uRm4gIT09ICdmdW5jdGlvbicpIHtcblx0dGhyb3cgbmV3IEVycm9yKFwiQWN0b3IuXCIrdHlwZStcIiBleHBlY3RzIGEgZnVuY3Rpb24gcHJvZHVjaW5nIGEgcGF0dGVybiBhcyBmaXJzdCBhcmd1bWVudFwiKTtcbiAgICB9XG4gICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7IC8vIE5COiBza2lwIHRoZSBmaXJzdCBhcmcgLSBpdCdzIHJhd1Byb2plY3Rpb25GblxuXHRpZiAodHlwZW9mIGFyZ3NbaV0gPT09ICdmdW5jdGlvbicpIHtcblx0ICAgIGlmIChoYW5kbGVyICE9PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlRvbyBtYW55IGhhbmRsZXIgZnVuY3Rpb25zIGluIEFjdG9yLlwiK3R5cGUpOyB9XG5cdCAgICBoYW5kbGVyID0gYXJnc1tpXTtcblx0fSBlbHNlIGlmICh0eXBlb2YgYXJnc1tpXSA9PT0gJ29iamVjdCcpIHtcblx0ICAgIGlmIChvcHRpb25zICE9PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlRvbyBtYW55IG9wdGlvbnMgYXJndW1lbnRzIGluIEFjdG9yLlwiK3R5cGUpOyB9XG5cdCAgICBvcHRpb25zID0gYXJnc1tpXTtcblx0fSBlbHNlIHtcblx0ICAgIHRocm93IG5ldyBFcnJvcihcIlVucmVjb2duaXNlZCBhcmd1bWVudCBpbiBBY3Rvci5cIit0eXBlKTtcblx0fVxuICAgIH1cbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICBmb3IgKHZhciBrIGluIG9wdGlvbnMpIHtcblx0aWYgKCEoayBpbiBkZWZhdWx0T3B0aW9ucykpIHtcblx0ICAgIHRocm93IG5ldyBFcnJvcihcIlVucmVjb2duaXNlZCBvcHRpb24gJ1wiK2srXCInIGluIEFjdG9yLlwiK3R5cGUpO1xuXHR9XG4gICAgfVxuICAgIGZvciAodmFyIGsgaW4gZGVmYXVsdE9wdGlvbnMpIHtcblx0aWYgKCEoayBpbiBvcHRpb25zKSkge1xuXHQgICAgb3B0aW9uc1trXSA9IGRlZmF1bHRPcHRpb25zW2tdO1xuXHR9XG4gICAgfVxuICAgIHJldHVybiB7XG5cdHR5cGU6IHR5cGUsXG5cdGtpbmQ6IGtpbmQsXG5cdHJhd1Byb2plY3Rpb25GbjogcmF3UHJvamVjdGlvbkZuLFxuXHRvcHRpb25zOiBvcHRpb25zLFxuXHRoYW5kbGVyOiBoYW5kbGVyXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcmVjb3JkQ2h1bmsoY2h1bmspIHtcbiAgICBBY3Rvci5fY2h1bmtzLnB1c2goY2h1bmspO1xufVxuXG5mdW5jdGlvbiBjaHVua0V4dHJhY3Rvcih0eXBlLCBraW5kLCBkZWZhdWx0T3B0aW9ucykge1xuICAgIHJldHVybiBmdW5jdGlvbiAoLyogLi4uICovKSB7XG5cdGNoZWNrQ2h1bmtzKHR5cGUpO1xuXHRyZWNvcmRDaHVuayhleHRyYWN0Q2h1bmsodHlwZSxcblx0XHRcdFx0IGtpbmQsXG5cdFx0XHRcdCBkZWZhdWx0T3B0aW9ucyxcblx0XHRcdFx0IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICB9O1xufVxuXG52YXIgcGFydGljaXBhbnREZWZhdWx0cyA9IHtcbiAgICBtZXRhTGV2ZWw6IDAsXG4gICAgd2hlbjogZnVuY3Rpb24gKCkgeyByZXR1cm4gdHJ1ZTsgfVxufTtcblxudmFyIG9ic2VydmVyRGVmYXVsdHMgPSB7XG4gICAgbWV0YUxldmVsOiAwLFxuICAgIGxldmVsOiAwLFxuICAgIHdoZW46IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRydWU7IH0sXG4gICAgcHJlc2VuY2U6IG51bGwsXG4gICAgbmFtZTogbnVsbCxcbiAgICBzaW5nbGV0b246IG51bGwsXG4gICAgc2V0OiBudWxsLFxuICAgIGFkZGVkOiBudWxsLFxuICAgIHJlbW92ZWQ6IG51bGxcbn07XG5cbkFjdG9yLmFkdmVydGlzZSA9IGNodW5rRXh0cmFjdG9yKCdhZHZlcnRpc2UnLCAncGFydGljaXBhbnQnLCBwYXJ0aWNpcGFudERlZmF1bHRzKTtcbkFjdG9yLnN1YnNjcmliZSA9IGNodW5rRXh0cmFjdG9yKCdzdWJzY3JpYmUnLCAncGFydGljaXBhbnQnLCBwYXJ0aWNpcGFudERlZmF1bHRzKTtcblxuQWN0b3Iub2JzZXJ2ZUFkdmVydGlzZXJzID0gY2h1bmtFeHRyYWN0b3IoJ29ic2VydmVBZHZlcnRpc2VycycsICdvYnNlcnZlcicsIG9ic2VydmVyRGVmYXVsdHMpO1xuQWN0b3Iub2JzZXJ2ZVN1YnNjcmliZXJzID0gY2h1bmtFeHRyYWN0b3IoJ29ic2VydmVTdWJzY3JpYmVycycsICdvYnNlcnZlcicsIG9ic2VydmVyRGVmYXVsdHMpO1xuXG5BY3Rvci5vYnNlcnZlR2VzdGFsdCA9IGZ1bmN0aW9uIChnZXN0YWx0Rm4sIGV2ZW50SGFuZGxlckZuKSB7XG4gICAgY2hlY2tDaHVua3MoJ29ic2VydmVHZXN0YWx0Jyk7XG4gICAgcmVjb3JkQ2h1bmsoe1xuXHR0eXBlOiAnb2JzZXJ2ZUdlc3RhbHQnLFxuXHRraW5kOiAncmF3Jyxcblx0Z2VzdGFsdEZuOiBnZXN0YWx0Rm4sXG5cdG9wdGlvbnM6IHtcblx0ICAgIHdoZW46IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRydWU7IH1cblx0fSxcblx0ZXZlbnRIYW5kbGVyRm46IGV2ZW50SGFuZGxlckZuXG4gICAgfSk7XG59O1xuXG5mdW5jdGlvbiBmaW5hbGl6ZUFjdG9yKGJlaGF2aW9yLCBjaHVua3MpIHtcbiAgICB2YXIgb2xkSGFuZGxlRXZlbnQgPSBiZWhhdmlvci5oYW5kbGVFdmVudDtcbiAgICB2YXIgcHJvamVjdGlvbnMgPSB7fTtcbiAgICB2YXIgY29tcGlsZWRQcm9qZWN0aW9ucyA9IHt9O1xuICAgIHZhciBwcmV2aW91c09ianMgPSB7fTtcblxuICAgIGJlaGF2aW9yLl9jb21wdXRlUm91dGVzID0gZnVuY3Rpb24gKCkge1xuXHR2YXIgbmV3Um91dGVzID0gUm91dGUuZW1wdHlHZXN0YWx0O1xuXHRmb3IgKHZhciBpID0gMDsgaSA8IGNodW5rcy5sZW5ndGg7IGkrKykge1xuXHQgICAgdmFyIGNodW5rID0gY2h1bmtzW2ldO1xuXHQgICAgaWYgKGNodW5rLm9wdGlvbnMud2hlbi5jYWxsKHRoaXMpKSB7XG5cdFx0c3dpdGNoIChjaHVuay5raW5kKSB7XG5cdFx0Y2FzZSAncmF3Jzpcblx0XHQgICAgbmV3Um91dGVzID0gbmV3Um91dGVzLnVuaW9uKGNodW5rLmdlc3RhbHRGbi5jYWxsKHRoaXMpKTtcblx0XHQgICAgYnJlYWs7XG5cdFx0Y2FzZSAncGFydGljaXBhbnQnOlxuXHRcdCAgICB2YXIgcHJvaiA9IGNodW5rLnJhd1Byb2plY3Rpb25Gbi5jYWxsKHRoaXMpO1xuXHRcdCAgICBwcm9qZWN0aW9uc1tpXSA9IHByb2o7XG5cdFx0ICAgIHZhciBnID0gUm91dGUuc2ltcGxlR2VzdGFsdChjaHVuay50eXBlID09PSAnYWR2ZXJ0aXNlJyxcblx0XHRcdFx0XHRcdFJvdXRlLnByb2plY3Rpb25Ub1BhdHRlcm4ocHJvaiksXG5cdFx0XHRcdFx0XHRjaHVuay5vcHRpb25zLm1ldGFMZXZlbCxcblx0XHRcdFx0XHRcdDApO1xuXHRcdCAgICBuZXdSb3V0ZXMgPSBuZXdSb3V0ZXMudW5pb24oZyk7XG5cdFx0ICAgIGJyZWFrO1xuXHRcdGNhc2UgJ29ic2VydmVyJzpcblx0XHQgICAgdmFyIHByb2ogPSBjaHVuay5yYXdQcm9qZWN0aW9uRm4uY2FsbCh0aGlzKTtcblx0XHQgICAgcHJvamVjdGlvbnNbaV0gPSBwcm9qO1xuXHRcdCAgICBjb21waWxlZFByb2plY3Rpb25zW2ldID0gUm91dGUuY29tcGlsZVByb2plY3Rpb24ocHJvaik7XG5cdFx0ICAgIHZhciBnID0gUm91dGUuc2ltcGxlR2VzdGFsdChjaHVuay50eXBlID09PSAnb2JzZXJ2ZVN1YnNjcmliZXJzJyxcblx0XHRcdFx0XHRcdFJvdXRlLnByb2plY3Rpb25Ub1BhdHRlcm4ocHJvaiksXG5cdFx0XHRcdFx0XHRjaHVuay5vcHRpb25zLm1ldGFMZXZlbCxcblx0XHRcdFx0XHRcdGNodW5rLm9wdGlvbnMubGV2ZWwgKyAxKTtcblx0XHQgICAgbmV3Um91dGVzID0gbmV3Um91dGVzLnVuaW9uKGcpO1xuXHRcdCAgICBpZiAoY2h1bmsub3B0aW9ucy5hZGRlZCB8fCBjaHVuay5vcHRpb25zLnJlbW92ZWQpIHtcblx0XHRcdHByZXZpb3VzT2Jqc1tpXSA9IFJvdXRlLmFycmF5VG9TZXQoW10pO1xuXHRcdCAgICB9XG5cdFx0ICAgIGJyZWFrO1xuXHRcdGRlZmF1bHQ6XG5cdFx0ICAgIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGNodW5rIHR5cGUva2luZDogXCIrY2h1bmsudHlwZStcIi9cIitjaHVuay5raW5kKTtcblx0XHR9XG5cdCAgICB9XG5cdH1cbiAgICAgICAgcmV0dXJuIG5ld1JvdXRlcztcbiAgICB9O1xuXG4gICAgYmVoYXZpb3IudXBkYXRlUm91dGVzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBXb3JsZC51cGRhdGVSb3V0ZXMoW3RoaXMuX2NvbXB1dGVSb3V0ZXMoKV0pO1xuICAgIH07XG5cbiAgICBiZWhhdmlvci5oYW5kbGVFdmVudCA9IGZ1bmN0aW9uIChlKSB7XG5cdGlmIChvbGRIYW5kbGVFdmVudCkgeyBvbGRIYW5kbGVFdmVudC5jYWxsKHRoaXMsIGUpOyB9XG5cdGZvciAodmFyIGkgPSAwOyBpIDwgY2h1bmtzLmxlbmd0aDsgaSsrKSB7XG5cdCAgICB2YXIgY2h1bmsgPSBjaHVua3NbaV07XG5cdCAgICBzd2l0Y2ggKGNodW5rLmtpbmQpIHtcblx0ICAgIGNhc2UgJ3Jhdyc6XG5cdFx0Y2h1bmsuZXZlbnRIYW5kbGVyRm4uY2FsbCh0aGlzLCBlKTtcblx0XHRicmVhaztcblx0ICAgIGNhc2UgJ3BhcnRpY2lwYW50Jzpcblx0XHRpZiAoY2h1bmsuaGFuZGxlclxuXHRcdCAgICAmJiAoZS50eXBlID09PSAnbWVzc2FnZScpXG5cdFx0ICAgICYmIChlLm1ldGFMZXZlbCA9PT0gY2h1bmsub3B0aW9ucy5tZXRhTGV2ZWwpXG5cdFx0ICAgICYmIChlLmlzRmVlZGJhY2sgPT09IChjaHVuay50eXBlID09PSAnYWR2ZXJ0aXNlJykpKVxuXHRcdHtcblx0XHQgICAgdmFyIG1hdGNoUmVzdWx0ID0gUm91dGUubWF0Y2hQYXR0ZXJuKGUubWVzc2FnZSwgcHJvamVjdGlvbnNbaV0pO1xuXHRcdCAgICBpZiAobWF0Y2hSZXN1bHQpIHtcblx0XHRcdHV0aWwua3dBcHBseShjaHVuay5oYW5kbGVyLCB0aGlzLCBtYXRjaFJlc3VsdCk7XG5cdFx0ICAgIH1cblx0XHR9XG5cdFx0YnJlYWs7XG5cdCAgICBjYXNlICdvYnNlcnZlcic6XG5cdFx0aWYgKGUudHlwZSA9PT0gJ3JvdXRlcycpIHtcblx0XHQgICAgdmFyIHByb2plY3Rpb25SZXN1bHQgPSBlLmdlc3RhbHQucHJvamVjdChjb21waWxlZFByb2plY3Rpb25zW2ldLFxuXHRcdFx0XHRcdFx0XHQgICAgIGNodW5rLnR5cGUgIT09ICdvYnNlcnZlU3Vic2NyaWJlcnMnLFxuXHRcdFx0XHRcdFx0XHQgICAgIGNodW5rLm9wdGlvbnMubWV0YUxldmVsLFxuXHRcdFx0XHRcdFx0XHQgICAgIGNodW5rLm9wdGlvbnMubGV2ZWwpO1xuXG5cdFx0ICAgIHZhciBpc1ByZXNlbnQgPSAhUm91dGUuaXNfZW1wdHlNYXRjaGVyKHByb2plY3Rpb25SZXN1bHQpO1xuXHRcdCAgICBpZiAoY2h1bmsub3B0aW9ucy5wcmVzZW5jZSkge1xuXHRcdFx0dGhpc1tjaHVuay5vcHRpb25zLnByZXNlbmNlXSA9IGlzUHJlc2VudDtcblx0XHQgICAgfVxuXG5cdFx0ICAgIHZhciBvYmpzID0gW107XG5cdFx0ICAgIGlmIChpc1ByZXNlbnQpIHtcblx0XHRcdHZhciBrZXlzID0gUm91dGUubWF0Y2hlcktleXMocHJvamVjdGlvblJlc3VsdCk7XG5cdFx0XHRpZiAoa2V5cyA9PT0gbnVsbCkge1xuXHRcdFx0ICAgIGNvbnNvbGUud2FybihcIldpbGRjYXJkIGRldGVjdGVkIHdoaWxlIHByb2plY3RpbmcgKFwiXG5cdFx0XHRcdFx0ICtKU09OLnN0cmluZ2lmeShjaHVuay5vcHRpb25zKStcIilcIik7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0ICAgIG9ianMgPSBSb3V0ZS5tYXRjaGVyS2V5c1RvT2JqZWN0cyhrZXlzLCBjb21waWxlZFByb2plY3Rpb25zW2ldKTtcblx0XHRcdCAgICBpZiAoY2h1bmsub3B0aW9ucy5zZXQpIHtcblx0XHRcdFx0Zm9yICh2YXIgaiA9IDA7IGogPCBvYmpzLmxlbmd0aDsgaisrKSB7XG5cdFx0XHRcdCAgICBvYmpzW2pdID0gY2h1bmsub3B0aW9ucy5zZXQuY2FsbCh0aGlzLCBvYmpzW2pdKTtcblx0XHRcdFx0fVxuXHRcdFx0ICAgIH1cblx0XHRcdH1cblx0XHQgICAgfVxuXHRcdCAgICBpZiAoY2h1bmsub3B0aW9ucy5uYW1lKSB7XG5cdFx0XHR0aGlzW2NodW5rLm9wdGlvbnMubmFtZV0gPSBvYmpzO1xuXHRcdCAgICB9XG5cdFx0ICAgIGlmIChjaHVuay5vcHRpb25zLnNpbmdsZXRvbikge1xuXHRcdFx0dGhpc1tjaHVuay5vcHRpb25zLnNpbmdsZXRvbl0gPSBvYmpzLmxlbmd0aCA9PT0gMSA/IG9ianNbMF0gOiB1bmRlZmluZWQ7XG5cdFx0ICAgIH1cblxuXHRcdCAgICBpZiAoY2h1bmsub3B0aW9ucy5hZGRlZCB8fCBjaHVuay5vcHRpb25zLnJlbW92ZWQpIHtcblx0XHRcdHZhciBvYmpTZXQgPSBSb3V0ZS5hcnJheVRvU2V0KG9ianMpO1xuXG5cdFx0XHRpZiAoY2h1bmsub3B0aW9ucy5hZGRlZCkge1xuXHRcdFx0ICAgIHRoaXNbY2h1bmsub3B0aW9ucy5hZGRlZF0gPVxuXHRcdFx0XHRSb3V0ZS5zZXRUb0FycmF5KFJvdXRlLnNldFN1YnRyYWN0KG9ialNldCwgcHJldmlvdXNPYmpzW2ldKSk7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChjaHVuay5vcHRpb25zLnJlbW92ZWQpIHtcblx0XHRcdCAgICB0aGlzW2NodW5rLm9wdGlvbnMucmVtb3ZlZF0gPVxuXHRcdFx0XHRSb3V0ZS5zZXRUb0FycmF5KFJvdXRlLnNldFN1YnRyYWN0KHByZXZpb3VzT2Jqc1tpXSwgb2JqU2V0KSk7XG5cdFx0XHR9XG5cblx0XHRcdHByZXZpb3VzT2Jqc1tpXSA9IG9ialNldDtcblx0XHQgICAgfVxuXG5cdFx0ICAgIGlmIChjaHVuay5oYW5kbGVyKSB7XG5cdFx0XHRjaHVuay5oYW5kbGVyLmNhbGwodGhpcyk7XG5cdFx0ICAgIH1cblx0XHR9XG5cdFx0YnJlYWs7XG5cdCAgICBkZWZhdWx0OlxuXHRcdHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGNodW5rIHR5cGUva2luZDogXCIrY2h1bmsudHlwZStcIi9cIitjaHVuay5raW5kKTtcblx0ICAgIH1cblx0fVxuICAgIH07XG5cbiAgICBpZiAoYmVoYXZpb3IuYm9vdCkgeyBiZWhhdmlvci5ib290KCk7IH1cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNodW5rcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGNodW5rID0gY2h1bmtzW2ldO1xuICAgICAgaWYgKGNodW5rLmtpbmQgPT09ICdvYnNlcnZlcicpIHtcblx0aWYgKGNodW5rLm9wdGlvbnMucHJlc2VuY2UpIHsgYmVoYXZpb3JbY2h1bmsub3B0aW9ucy5wcmVzZW5jZV0gPSBmYWxzZTsgfVxuXHRpZiAoY2h1bmsub3B0aW9ucy5uYW1lKSB7IGJlaGF2aW9yW2NodW5rLm9wdGlvbnMubmFtZV0gPSBbXTsgfVxuXHRpZiAoY2h1bmsub3B0aW9ucy5zaW5nbGV0b24pIHsgYmVoYXZpb3JbY2h1bmsub3B0aW9ucy5zaW5nbGV0b25dID0gdW5kZWZpbmVkOyB9XG5cdGlmIChjaHVuay5vcHRpb25zLmFkZGVkKSB7IGJlaGF2aW9yW2NodW5rLm9wdGlvbnMuYWRkZWRdID0gW107IH1cblx0aWYgKGNodW5rLm9wdGlvbnMucmVtb3ZlZCkgeyBiZWhhdmlvcltjaHVuay5vcHRpb25zLnJlbW92ZWRdID0gW107IH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYmVoYXZpb3IuX2NvbXB1dGVSb3V0ZXMoKTtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbm1vZHVsZS5leHBvcnRzLkFjdG9yID0gQWN0b3I7XG4iLCIvLyBXaXJlIHByb3RvY29sIHJlcHJlc2VudGF0aW9uIG9mIGV2ZW50cyBhbmQgYWN0aW9uc1xuXG52YXIgUm91dGUgPSByZXF1aXJlKFwiLi9yb3V0ZS5qc1wiKTtcblxuZnVuY3Rpb24gX2VuY29kZShlKSB7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICBjYXNlIFwicm91dGVzXCI6XG5cdHJldHVybiBbXCJyb3V0ZXNcIiwgZS5nZXN0YWx0LnNlcmlhbGl6ZShmdW5jdGlvbiAodikgeyByZXR1cm4gdHJ1ZTsgfSldO1xuICAgIGNhc2UgXCJtZXNzYWdlXCI6XG5cdHJldHVybiBbXCJtZXNzYWdlXCIsIGUubWVzc2FnZSwgZS5tZXRhTGV2ZWwsIGUuaXNGZWVkYmFja107XG4gICAgfVxufVxuXG5mdW5jdGlvbiBfZGVjb2RlKHdoYXQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChqKSB7XG4gICAgc3dpdGNoIChqWzBdKSB7XG4gICAgY2FzZSBcInJvdXRlc1wiOlxuICAgICAgcmV0dXJuIE1pbmltYXJ0LnVwZGF0ZVJvdXRlcyhbXG5cdFJvdXRlLmRlc2VyaWFsaXplR2VzdGFsdChqWzFdLCBmdW5jdGlvbiAodikgeyByZXR1cm4gdHJ1ZTsgfSldKTtcbiAgICBjYXNlIFwibWVzc2FnZVwiOlxuICAgICAgcmV0dXJuIE1pbmltYXJ0LnNlbmRNZXNzYWdlKGpbMV0sIGpbMl0sIGpbM10pO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyB7IG1lc3NhZ2U6IFwiSW52YWxpZCBKU09OLWVuY29kZWQgXCIgKyB3aGF0ICsgXCI6IFwiICsgSlNPTi5zdHJpbmdpZnkoaikgfTtcbiAgICB9XG4gIH07XG59XG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5tb2R1bGUuZXhwb3J0cy5lbmNvZGVFdmVudCA9IF9lbmNvZGU7XG5tb2R1bGUuZXhwb3J0cy5kZWNvZGVFdmVudCA9IF9kZWNvZGUoXCJldmVudFwiKTtcbm1vZHVsZS5leHBvcnRzLmVuY29kZUFjdGlvbiA9IF9lbmNvZGU7XG5tb2R1bGUuZXhwb3J0cy5kZWNvZGVBY3Rpb24gPSBfZGVjb2RlKFwiYWN0aW9uXCIpO1xuIiwiLy8gRE9NIGZyYWdtZW50IGRpc3BsYXkgZHJpdmVyXG52YXIgTWluaW1hcnQgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIHN1YiA9IE1pbmltYXJ0LnN1YjtcbnZhciBwdWIgPSBNaW5pbWFydC5wdWI7XG52YXIgX18gPSBNaW5pbWFydC5fXztcbnZhciBfJCA9IE1pbmltYXJ0Ll8kO1xuXG5mdW5jdGlvbiBzcGF3bkRPTURyaXZlcihkb21XcmFwRnVuY3Rpb24sIGpRdWVyeVdyYXBGdW5jdGlvbikge1xuICAgIGRvbVdyYXBGdW5jdGlvbiA9IGRvbVdyYXBGdW5jdGlvbiB8fCBkZWZhdWx0V3JhcEZ1bmN0aW9uO1xuICAgIHZhciBkID0gbmV3IE1pbmltYXJ0LkRlbWFuZE1hdGNoZXIoZG9tV3JhcEZ1bmN0aW9uKF8kLCBfJCwgXyQpKTtcbiAgICBkLm9uRGVtYW5kSW5jcmVhc2UgPSBmdW5jdGlvbiAoY2FwdHVyZXMpIHtcblx0dmFyIHNlbGVjdG9yID0gY2FwdHVyZXNbMF07XG5cdHZhciBmcmFnbWVudENsYXNzID0gY2FwdHVyZXNbMV07XG5cdHZhciBmcmFnbWVudFNwZWMgPSBjYXB0dXJlc1syXTtcblx0V29ybGQuc3Bhd24obmV3IERPTUZyYWdtZW50KHNlbGVjdG9yLFxuXHRcdFx0XHQgICAgZnJhZ21lbnRDbGFzcyxcblx0XHRcdFx0ICAgIGZyYWdtZW50U3BlYyxcblx0XHRcdFx0ICAgIGRvbVdyYXBGdW5jdGlvbixcblx0XHRcdFx0ICAgIGpRdWVyeVdyYXBGdW5jdGlvbikpO1xuICAgIH07XG4gICAgV29ybGQuc3Bhd24oZCk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXcmFwRnVuY3Rpb24oc2VsZWN0b3IsIGZyYWdtZW50Q2xhc3MsIGZyYWdtZW50U3BlYykge1xuICAgIHJldHVybiBbXCJET01cIiwgc2VsZWN0b3IsIGZyYWdtZW50Q2xhc3MsIGZyYWdtZW50U3BlY107XG59XG5cbmZ1bmN0aW9uIERPTUZyYWdtZW50KHNlbGVjdG9yLCBmcmFnbWVudENsYXNzLCBmcmFnbWVudFNwZWMsIGRvbVdyYXBGdW5jdGlvbiwgalF1ZXJ5V3JhcEZ1bmN0aW9uKSB7XG4gICAgdGhpcy5zZWxlY3RvciA9IHNlbGVjdG9yO1xuICAgIHRoaXMuZnJhZ21lbnRDbGFzcyA9IGZyYWdtZW50Q2xhc3M7XG4gICAgdGhpcy5mcmFnbWVudFNwZWMgPSBmcmFnbWVudFNwZWM7XG4gICAgdGhpcy5kb21XcmFwRnVuY3Rpb24gPSBkb21XcmFwRnVuY3Rpb247XG4gICAgdGhpcy5qUXVlcnlXcmFwRnVuY3Rpb24gPSBqUXVlcnlXcmFwRnVuY3Rpb247XG4gICAgdGhpcy5ub2RlcyA9IHRoaXMuYnVpbGROb2RlcygpO1xufVxuXG5ET01GcmFnbWVudC5wcm90b3R5cGUuYm9vdCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIG1vbml0b3JpbmcgPVxuXHRzdWIoc2VsZi5kb21XcmFwRnVuY3Rpb24oc2VsZi5zZWxlY3Rvciwgc2VsZi5mcmFnbWVudENsYXNzLCBzZWxmLmZyYWdtZW50U3BlYyksIDEsIDIpO1xuXG4gICAgV29ybGQuc3Bhd24obmV3IFdvcmxkKGZ1bmN0aW9uICgpIHtcblx0TWluaW1hcnQuSlF1ZXJ5LnNwYXduSlF1ZXJ5RHJpdmVyKHNlbGYuc2VsZWN0b3IrXCIgPiAuXCIrc2VsZi5mcmFnbWVudENsYXNzLFxuXHRcdFx0XHRcdCAgMSxcblx0XHRcdFx0XHQgIHNlbGYualF1ZXJ5V3JhcEZ1bmN0aW9uKTtcblx0V29ybGQuc3Bhd24oe1xuXHQgICAgYm9vdDogZnVuY3Rpb24gKCkgeyByZXR1cm4gW21vbml0b3JpbmddIH0sXG5cdCAgICBoYW5kbGVFdmVudDogZnVuY3Rpb24gKGUpIHtcblx0XHRpZiAoZS50eXBlID09PSBcInJvdXRlc1wiKSB7XG5cdFx0ICAgIHZhciBsZXZlbCA9IGUuZ2VzdGFsdC5nZXRMZXZlbCgxLCAwKTsgLy8gZmluZCBwYXJ0aWNpcGFudCBwZWVyc1xuXHRcdCAgICBpZiAoIWUuZ2VzdGFsdC5pc0VtcHR5KCkgJiYgbGV2ZWwuaXNFbXB0eSgpKSB7XG5cdFx0XHRXb3JsZC5zaHV0ZG93bldvcmxkKCk7XG5cdFx0ICAgIH1cblx0XHR9XG5cdCAgICB9XG5cdH0pO1xuICAgIH0pKTtcblxuICAgIHJldHVybiBbc3ViKHNlbGYuZG9tV3JhcEZ1bmN0aW9uKHNlbGYuc2VsZWN0b3IsIHNlbGYuZnJhZ21lbnRDbGFzcywgc2VsZi5mcmFnbWVudFNwZWMpKSxcblx0ICAgIHN1YihzZWxmLmRvbVdyYXBGdW5jdGlvbihzZWxmLnNlbGVjdG9yLCBzZWxmLmZyYWdtZW50Q2xhc3MsIHNlbGYuZnJhZ21lbnRTcGVjKSwgMCwgMSldXG59O1xuXG5ET01GcmFnbWVudC5wcm90b3R5cGUuaGFuZGxlRXZlbnQgPSBmdW5jdGlvbiAoZSkge1xuICAgIGlmIChlLnR5cGUgPT09IFwicm91dGVzXCIgJiYgZS5nZXN0YWx0LmlzRW1wdHkoKSkge1xuXHRmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMubm9kZXMubGVuZ3RoOyBpKyspIHtcblx0ICAgIHZhciBuID0gdGhpcy5ub2Rlc1tpXTtcblx0ICAgIG4ucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChuKTtcblx0fVxuXHRXb3JsZC5leGl0KCk7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gaXNBdHRyaWJ1dGVzKHgpIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheSh4KSAmJiAoKHgubGVuZ3RoID09PSAwKSB8fCBBcnJheS5pc0FycmF5KHhbMF0pKTtcbn1cblxuRE9NRnJhZ21lbnQucHJvdG90eXBlLmludGVycHJldFNwZWMgPSBmdW5jdGlvbiAoc3BlYykge1xuICAgIC8vIEZyYWdtZW50IHNwZWNzIGFyZSByb3VnaGx5IEpTT04tZXF1aXZhbGVudHMgb2YgU1hNTC5cbiAgICAvLyBzcGVjIDo6PT0gW1widGFnXCIsIFtbXCJhdHRyXCIsIFwidmFsdWVcIl0sIC4uLl0sIHNwZWMsIHNwZWMsIC4uLl1cbiAgICAvLyAgICAgICAgIHwgW1widGFnXCIsIHNwZWMsIHNwZWMsIC4uLl1cbiAgICAvLyAgICAgICAgIHwgXCJjZGF0YVwiXG4gICAgaWYgKHR5cGVvZihzcGVjKSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2Yoc3BlYykgPT09IFwibnVtYmVyXCIpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHNwZWMpO1xuICAgIH0gZWxzZSBpZiAoJC5pc0FycmF5KHNwZWMpKSB7XG5cdHZhciB0YWdOYW1lID0gc3BlY1swXTtcblx0dmFyIGhhc0F0dHJzID0gaXNBdHRyaWJ1dGVzKHNwZWNbMV0pO1xuXHR2YXIgYXR0cnMgPSBoYXNBdHRycyA/IHNwZWNbMV0gOiB7fTtcblx0dmFyIGtpZEluZGV4ID0gaGFzQXR0cnMgPyAyIDogMTtcblxuXHQvLyBXb3chIFN1Y2ggWFNTISBNYW55IGhhY2tzISBTbyB2dWxuZXJhYmlsaXR5ISBBbWF6ZSFcblx0dmFyIG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZ05hbWUpO1xuXHRmb3IgKHZhciBpID0gMDsgaSA8IGF0dHJzLmxlbmd0aDsgaSsrKSB7XG5cdCAgICBuLnNldEF0dHJpYnV0ZShhdHRyc1tpXVswXSwgYXR0cnNbaV1bMV0pO1xuXHR9XG5cdGZvciAodmFyIGkgPSBraWRJbmRleDsgaSA8IHNwZWMubGVuZ3RoOyBpKyspIHtcblx0ICAgIG4uYXBwZW5kQ2hpbGQodGhpcy5pbnRlcnByZXRTcGVjKHNwZWNbaV0pKTtcblx0fVxuXHRyZXR1cm4gbjtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbGwtZm9ybWVkIERPTSBzcGVjaWZpY2F0aW9uXCIpO1xuICAgIH1cbn07XG5cbkRPTUZyYWdtZW50LnByb3RvdHlwZS5idWlsZE5vZGVzID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgbm9kZXMgPSBbXTtcbiAgICAkKHNlbGYuc2VsZWN0b3IpLmVhY2goZnVuY3Rpb24gKGluZGV4LCBkb21Ob2RlKSB7XG5cdHZhciBuID0gc2VsZi5pbnRlcnByZXRTcGVjKHNlbGYuZnJhZ21lbnRTcGVjKTtcblx0bi5jbGFzc0xpc3QuYWRkKHNlbGYuZnJhZ21lbnRDbGFzcyk7XG5cdGRvbU5vZGUuYXBwZW5kQ2hpbGQobik7XG5cdG5vZGVzLnB1c2gobik7XG4gICAgfSk7XG4gICAgcmV0dXJuIG5vZGVzO1xufTtcblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbm1vZHVsZS5leHBvcnRzLnNwYXduRE9NRHJpdmVyID0gc3Bhd25ET01Ecml2ZXI7XG5tb2R1bGUuZXhwb3J0cy5kZWZhdWx0V3JhcEZ1bmN0aW9uID0gZGVmYXVsdFdyYXBGdW5jdGlvbjtcbiIsIi8qIEdyb3VuZCBpbnRlcmZhY2UgKi9cbnZhciBNaW5pbWFydCA9IHJlcXVpcmUoXCIuL21pbmltYXJ0LmpzXCIpO1xudmFyIFdvcmxkID0gTWluaW1hcnQuV29ybGQ7XG5cbmZ1bmN0aW9uIEdyb3VuZChib290Rm4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdGhpcy5zdGVwcGVySWQgPSBudWxsO1xuICAgIFdvcmxkLndpdGhXb3JsZFN0YWNrKFtbdGhpcywgLTFdXSwgZnVuY3Rpb24gKCkge1xuXHRzZWxmLndvcmxkID0gbmV3IFdvcmxkKGJvb3RGbik7XG4gICAgfSk7XG59XG5cbkdyb3VuZC5wcm90b3R5cGUuc3RlcCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIFdvcmxkLndpdGhXb3JsZFN0YWNrKFtbdGhpcywgLTFdXSwgZnVuY3Rpb24gKCkge1xuXHRyZXR1cm4gc2VsZi53b3JsZC5zdGVwKCk7XG4gICAgfSk7XG59O1xuXG5Hcm91bmQucHJvdG90eXBlLmNoZWNrUGlkID0gZnVuY3Rpb24gKHBpZCkge1xuICAgIGlmIChwaWQgIT09IC0xKSBjb25zb2xlLmVycm9yKFwiV2VpcmQgcGlkIGluIEdyb3VuZCBtYXJrUGlkUnVubmFibGVcIiwgcGlkKTtcbn07XG5cbkdyb3VuZC5wcm90b3R5cGUubWFya1BpZFJ1bm5hYmxlID0gZnVuY3Rpb24gKHBpZCkge1xuICAgIHRoaXMuY2hlY2tQaWQocGlkKTtcbiAgICB0aGlzLnN0YXJ0U3RlcHBpbmcoKTtcbn07XG5cbkdyb3VuZC5wcm90b3R5cGUuc3RhcnRTdGVwcGluZyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHRoaXMuc3RlcHBlcklkKSByZXR1cm47XG4gICAgaWYgKHRoaXMuc3RlcCgpKSB7XG5cdHRoaXMuc3RlcHBlcklkID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG5cdCAgICBzZWxmLnN0ZXBwZXJJZCA9IG51bGw7XG5cdCAgICBzZWxmLnN0YXJ0U3RlcHBpbmcoKTtcblx0fSwgMCk7XG4gICAgfVxufTtcblxuR3JvdW5kLnByb3RvdHlwZS5zdG9wU3RlcHBpbmcgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMuc3RlcHBlcklkKSB7XG5cdGNsZWFyVGltZW91dCh0aGlzLnN0ZXBwZXJJZCk7XG5cdHRoaXMuc3RlcHBlcklkID0gbnVsbDtcbiAgICB9XG59O1xuXG5Hcm91bmQucHJvdG90eXBlLmVucXVldWVBY3Rpb24gPSBmdW5jdGlvbiAocGlkLCBhY3Rpb24pIHtcbiAgICB0aGlzLmNoZWNrUGlkKHBpZCk7XG4gICAgaWYgKGFjdGlvbi50eXBlID09PSAncm91dGVzJykge1xuXHRpZiAoIWFjdGlvbi5nZXN0YWx0LmlzRW1wdHkoKSkge1xuXHQgICAgY29uc29sZS5lcnJvcihcIllvdSBoYXZlIHN1YnNjcmliZWQgdG8gYSBub25leGlzdGVudCBldmVudCBzb3VyY2UuXCIsXG5cdFx0XHQgIGFjdGlvbi5nZXN0YWx0LnByZXR0eSgpKTtcblx0fVxuICAgIH0gZWxzZSB7XG5cdGNvbnNvbGUuZXJyb3IoXCJZb3UgaGF2ZSBzZW50IGEgbWVzc2FnZSBpbnRvIHRoZSBvdXRlciB2b2lkLlwiLCBhY3Rpb24pO1xuICAgIH1cbn07XG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5tb2R1bGUuZXhwb3J0cy5Hcm91bmQgPSBHcm91bmQ7XG4iLCIvLyBKUXVlcnkgZXZlbnQgZHJpdmVyXG52YXIgTWluaW1hcnQgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIHN1YiA9IE1pbmltYXJ0LnN1YjtcbnZhciBwdWIgPSBNaW5pbWFydC5wdWI7XG52YXIgX18gPSBNaW5pbWFydC5fXztcbnZhciBfJCA9IE1pbmltYXJ0Ll8kO1xuXG5mdW5jdGlvbiBzcGF3bkpRdWVyeURyaXZlcihiYXNlU2VsZWN0b3IsIG1ldGFMZXZlbCwgd3JhcEZ1bmN0aW9uKSB7XG4gICAgbWV0YUxldmVsID0gbWV0YUxldmVsIHx8IDA7XG4gICAgd3JhcEZ1bmN0aW9uID0gd3JhcEZ1bmN0aW9uIHx8IGRlZmF1bHRXcmFwRnVuY3Rpb247XG4gICAgdmFyIGQgPSBuZXcgTWluaW1hcnQuRGVtYW5kTWF0Y2hlcih3cmFwRnVuY3Rpb24oXyQsIF8kLCBfXyksIG1ldGFMZXZlbCxcblx0XHRcdFx0ICAgICAgIHtkZW1hbmRTaWRlSXNTdWJzY3JpcHRpb246IHRydWV9KTtcbiAgICBkLm9uRGVtYW5kSW5jcmVhc2UgPSBmdW5jdGlvbiAoY2FwdHVyZXMpIHtcblx0dmFyIHNlbGVjdG9yID0gY2FwdHVyZXNbMF07XG5cdHZhciBldmVudE5hbWUgPSBjYXB0dXJlc1sxXTtcblx0V29ybGQuc3Bhd24obmV3IEpRdWVyeUV2ZW50Um91dGVyKGJhc2VTZWxlY3Rvcixcblx0XHRcdFx0XHQgIHNlbGVjdG9yLFxuXHRcdFx0XHRcdCAgZXZlbnROYW1lLFxuXHRcdFx0XHRcdCAgbWV0YUxldmVsLFxuXHRcdFx0XHRcdCAgd3JhcEZ1bmN0aW9uKSk7XG4gICAgfTtcbiAgICBXb3JsZC5zcGF3bihkKTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFdyYXBGdW5jdGlvbihzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudFZhbHVlKSB7XG4gICAgcmV0dXJuIFtcImpRdWVyeVwiLCBzZWxlY3RvciwgZXZlbnROYW1lLCBldmVudFZhbHVlXTtcbn1cblxuZnVuY3Rpb24gSlF1ZXJ5RXZlbnRSb3V0ZXIoYmFzZVNlbGVjdG9yLCBzZWxlY3RvciwgZXZlbnROYW1lLCBtZXRhTGV2ZWwsIHdyYXBGdW5jdGlvbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmJhc2VTZWxlY3RvciA9IGJhc2VTZWxlY3RvciB8fCBudWxsO1xuICAgIHRoaXMuc2VsZWN0b3IgPSBzZWxlY3RvcjtcbiAgICB0aGlzLmV2ZW50TmFtZSA9IGV2ZW50TmFtZTtcbiAgICB0aGlzLm1ldGFMZXZlbCA9IG1ldGFMZXZlbCB8fCAwO1xuICAgIHRoaXMud3JhcEZ1bmN0aW9uID0gd3JhcEZ1bmN0aW9uIHx8IGRlZmF1bHRXcmFwRnVuY3Rpb247XG4gICAgdGhpcy5wcmV2ZW50RGVmYXVsdCA9ICh0aGlzLmV2ZW50TmFtZS5jaGFyQXQoMCkgIT09IFwiK1wiKTtcbiAgICB0aGlzLmhhbmRsZXIgPVxuXHRXb3JsZC53cmFwKGZ1bmN0aW9uIChlKSB7XG5cdCAgICBXb3JsZC5zZW5kKHNlbGYud3JhcEZ1bmN0aW9uKHNlbGYuc2VsZWN0b3IsIHNlbGYuZXZlbnROYW1lLCBlKSwgc2VsZi5tZXRhTGV2ZWwpO1xuXHQgICAgaWYgKHNlbGYucHJldmVudERlZmF1bHQpIGUucHJldmVudERlZmF1bHQoKTtcblx0ICAgIHJldHVybiAhc2VsZi5wcmV2ZW50RGVmYXVsdDtcblx0fSk7XG4gICAgdGhpcy5jb21wdXRlTm9kZXMoKS5vbih0aGlzLnByZXZlbnREZWZhdWx0ID8gdGhpcy5ldmVudE5hbWUgOiB0aGlzLmV2ZW50TmFtZS5zdWJzdHJpbmcoMSksXG5cdFx0XHQgICB0aGlzLmhhbmRsZXIpO1xufVxuXG5KUXVlcnlFdmVudFJvdXRlci5wcm90b3R5cGUuYm9vdCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIFtwdWIodGhpcy53cmFwRnVuY3Rpb24odGhpcy5zZWxlY3RvciwgdGhpcy5ldmVudE5hbWUsIF9fKSwgdGhpcy5tZXRhTGV2ZWwpLFxuXHQgIHB1Yih0aGlzLndyYXBGdW5jdGlvbih0aGlzLnNlbGVjdG9yLCB0aGlzLmV2ZW50TmFtZSwgX18pLCB0aGlzLm1ldGFMZXZlbCwgMSldO1xufTtcblxuSlF1ZXJ5RXZlbnRSb3V0ZXIucHJvdG90eXBlLmhhbmRsZUV2ZW50ID0gZnVuY3Rpb24gKGUpIHtcbiAgICBpZiAoZS50eXBlID09PSBcInJvdXRlc1wiICYmIGUuZ2VzdGFsdC5pc0VtcHR5KCkpIHtcblx0dGhpcy5jb21wdXRlTm9kZXMoKS5vZmYodGhpcy5ldmVudE5hbWUsIHRoaXMuaGFuZGxlcik7XG5cdFdvcmxkLmV4aXQoKTtcbiAgICB9XG59O1xuXG5KUXVlcnlFdmVudFJvdXRlci5wcm90b3R5cGUuY29tcHV0ZU5vZGVzID0gZnVuY3Rpb24gKCkge1xuICAgIGlmICh0aGlzLmJhc2VTZWxlY3Rvcikge1xuXHRyZXR1cm4gJCh0aGlzLmJhc2VTZWxlY3RvcikuY2hpbGRyZW4odGhpcy5zZWxlY3RvcikuYWRkQmFjayh0aGlzLnNlbGVjdG9yKTtcbiAgICB9IGVsc2Uge1xuXHRyZXR1cm4gJCh0aGlzLnNlbGVjdG9yKTtcbiAgICB9XG59O1xuXG5mdW5jdGlvbiBzaW1wbGlmeURPTUV2ZW50KGUpIHtcbiAgICB2YXIga2V5cyA9IFtdO1xuICAgIGZvciAodmFyIGsgaW4gZSkge1xuXHR2YXIgdiA9IGVba107XG5cdGlmICh0eXBlb2YgdiA9PT0gJ29iamVjdCcpIGNvbnRpbnVlO1xuXHRpZiAodHlwZW9mIHYgPT09ICdmdW5jdGlvbicpIGNvbnRpbnVlO1xuXHRrZXlzLnB1c2goayk7XG4gICAgfVxuICAgIGtleXMuc29ydCgpO1xuICAgIHZhciBzaW1wbGlmaWVkID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG5cdHNpbXBsaWZpZWQucHVzaChba2V5c1tpXSwgZVtrZXlzW2ldXV0pO1xuICAgIH1cbiAgICByZXR1cm4gc2ltcGxpZmllZDtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbm1vZHVsZS5leHBvcnRzLnNwYXduSlF1ZXJ5RHJpdmVyID0gc3Bhd25KUXVlcnlEcml2ZXI7XG5tb2R1bGUuZXhwb3J0cy5zaW1wbGlmeURPTUV2ZW50ID0gc2ltcGxpZnlET01FdmVudDtcbm1vZHVsZS5leHBvcnRzLmRlZmF1bHRXcmFwRnVuY3Rpb24gPSBkZWZhdWx0V3JhcEZ1bmN0aW9uO1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcblxubW9kdWxlLmV4cG9ydHMuRE9NID0gcmVxdWlyZShcIi4vZG9tLWRyaXZlci5qc1wiKTtcbm1vZHVsZS5leHBvcnRzLkpRdWVyeSA9IHJlcXVpcmUoXCIuL2pxdWVyeS1kcml2ZXIuanNcIik7XG5tb2R1bGUuZXhwb3J0cy5Sb3V0aW5nVGFibGVXaWRnZXQgPSByZXF1aXJlKFwiLi9yb3V0aW5nLXRhYmxlLXdpZGdldC5qc1wiKTtcbm1vZHVsZS5leHBvcnRzLldlYlNvY2tldCA9IHJlcXVpcmUoXCIuL3dlYnNvY2tldC1kcml2ZXIuanNcIik7XG5tb2R1bGUuZXhwb3J0cy5SZWZsZWN0ID0gcmVxdWlyZShcIi4vcmVmbGVjdC5qc1wiKTtcblxubW9kdWxlLmV4cG9ydHMuR3JvdW5kID0gcmVxdWlyZShcIi4vZ3JvdW5kLmpzXCIpLkdyb3VuZDtcbm1vZHVsZS5leHBvcnRzLkFjdG9yID0gcmVxdWlyZShcIi4vYWN0b3IuanNcIikuQWN0b3I7XG5tb2R1bGUuZXhwb3J0cy5TcHkgPSByZXF1aXJlKFwiLi9zcHkuanNcIikuU3B5O1xubW9kdWxlLmV4cG9ydHMuV2FrZURldGVjdG9yID0gcmVxdWlyZShcIi4vd2FrZS1kZXRlY3Rvci5qc1wiKS5XYWtlRGV0ZWN0b3I7XG5cbnZhciBXb3JrZXIgPSByZXF1aXJlKFwiLi93b3JrZXIuanNcIik7XG5tb2R1bGUuZXhwb3J0cy5Xb3JrZXIgPSBXb3JrZXIuV29ya2VyO1xubW9kdWxlLmV4cG9ydHMuV29ya2VyR3JvdW5kID0gV29ya2VyLldvcmtlckdyb3VuZDtcbiIsInZhciBSb3V0ZSA9IHJlcXVpcmUoXCIuL3JvdXRlLmpzXCIpO1xudmFyIFV0aWwgPSByZXF1aXJlKFwiLi91dGlsLmpzXCIpO1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuLy8gVE9ETzogdHJpZ2dlci1ndWFyZHMgYXMgcGVyIG1pbmltYXJ0XG5cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cbi8qIEV2ZW50cyBhbmQgQWN0aW9ucyAqL1xuXG52YXIgX18gPSBSb3V0ZS5fXztcbnZhciBfJCA9IFJvdXRlLl8kO1xuXG5mdW5jdGlvbiBzdWIocGF0dGVybiwgbWV0YUxldmVsLCBsZXZlbCkge1xuICAgIHJldHVybiBSb3V0ZS5zaW1wbGVHZXN0YWx0KGZhbHNlLCBwYXR0ZXJuLCBtZXRhTGV2ZWwsIGxldmVsKTtcbn1cblxuZnVuY3Rpb24gcHViKHBhdHRlcm4sIG1ldGFMZXZlbCwgbGV2ZWwpIHtcbiAgICByZXR1cm4gUm91dGUuc2ltcGxlR2VzdGFsdCh0cnVlLCBwYXR0ZXJuLCBtZXRhTGV2ZWwsIGxldmVsKTtcbn1cblxuZnVuY3Rpb24gc3Bhd24oYmVoYXZpb3IpIHtcbiAgICByZXR1cm4geyB0eXBlOiBcInNwYXduXCIsIGJlaGF2aW9yOiBiZWhhdmlvciB9O1xufVxuXG5mdW5jdGlvbiB1cGRhdGVSb3V0ZXMoZ2VzdGFsdHMpIHtcbiAgICByZXR1cm4geyB0eXBlOiBcInJvdXRlc1wiLCBnZXN0YWx0OiBSb3V0ZS5nZXN0YWx0VW5pb24oZ2VzdGFsdHMpIH07XG59XG5cbmZ1bmN0aW9uIHBlbmRpbmdSb3V0aW5nVXBkYXRlKGFnZ3JlZ2F0ZSwgYWZmZWN0ZWRTdWJnZXN0YWx0LCBrbm93blRhcmdldCkge1xuICAgIHJldHVybiB7IHR5cGU6IFwicGVuZGluZ1JvdXRpbmdVcGRhdGVcIixcblx0ICAgICBhZ2dyZWdhdGU6IGFnZ3JlZ2F0ZSxcblx0ICAgICBhZmZlY3RlZFN1Ymdlc3RhbHQ6IGFmZmVjdGVkU3ViZ2VzdGFsdCxcblx0ICAgICBrbm93blRhcmdldDoga25vd25UYXJnZXQgfTtcbn1cblxuZnVuY3Rpb24gc2VuZE1lc3NhZ2UobSwgbWV0YUxldmVsLCBpc0ZlZWRiYWNrKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogXCJtZXNzYWdlXCIsXG5cdCAgICAgbWV0YUxldmVsOiAobWV0YUxldmVsID09PSB1bmRlZmluZWQpID8gMCA6IG1ldGFMZXZlbCxcblx0ICAgICBtZXNzYWdlOiBtLFxuXHQgICAgIGlzRmVlZGJhY2s6IChpc0ZlZWRiYWNrID09PSB1bmRlZmluZWQpID8gZmFsc2UgOiBpc0ZlZWRiYWNrIH07XG59XG5cbmZ1bmN0aW9uIHNodXRkb3duV29ybGQoKSB7XG4gICAgcmV0dXJuIHsgdHlwZTogXCJzaHV0ZG93bldvcmxkXCIgfTtcbn1cblxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuLyogQ29uZmlndXJhdGlvbnMgKi9cblxuZnVuY3Rpb24gV29ybGQoYm9vdEZuKSB7XG4gICAgdGhpcy5hbGl2ZSA9IHRydWU7XG4gICAgdGhpcy5ldmVudFF1ZXVlID0gW107XG4gICAgdGhpcy5ydW5uYWJsZVBpZHMgPSB7fTtcbiAgICB0aGlzLnBhcnRpYWxHZXN0YWx0ID0gUm91dGUuZW1wdHlHZXN0YWx0OyAvLyBPbmx5IGdlc3RhbHQgZnJvbSBsb2NhbCBwcm9jZXNzZXNcbiAgICB0aGlzLmZ1bGxHZXN0YWx0ID0gUm91dGUuZW1wdHlHZXN0YWx0IDs7IC8vIHBhcnRpYWxHZXN0YWx0IHVuaW9uZWQgd2l0aCBkb3dud2FyZEdlc3RhbHRcbiAgICB0aGlzLnByb2Nlc3NUYWJsZSA9IHt9O1xuICAgIHRoaXMudG9tYnN0b25lcyA9IHt9O1xuICAgIHRoaXMuZG93bndhcmRHZXN0YWx0ID0gUm91dGUuZW1wdHlHZXN0YWx0O1xuICAgIHRoaXMucHJvY2Vzc0FjdGlvbnMgPSBbXTtcbiAgICB0aGlzLmFzQ2hpbGQoLTEsIGJvb3RGbiwgdHJ1ZSk7XG59XG5cbi8qIENsYXNzIHN0YXRlIC8gbWV0aG9kcyAqL1xuXG5Xb3JsZC5uZXh0UGlkID0gMDtcblxuV29ybGQuc3RhY2sgPSBbXTtcblxuV29ybGQuY3VycmVudCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gV29ybGQuc3RhY2tbV29ybGQuc3RhY2subGVuZ3RoIC0gMV1bMF07XG59O1xuXG5Xb3JsZC5hY3RpdmVQaWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIFdvcmxkLnN0YWNrW1dvcmxkLnN0YWNrLmxlbmd0aCAtIDFdWzFdO1xufTtcblxuV29ybGQuc2VuZCA9IGZ1bmN0aW9uIChtLCBtZXRhTGV2ZWwsIGlzRmVlZGJhY2spIHtcbiAgICBXb3JsZC5jdXJyZW50KCkuZW5xdWV1ZUFjdGlvbihXb3JsZC5hY3RpdmVQaWQoKSwgc2VuZE1lc3NhZ2UobSwgbWV0YUxldmVsLCBpc0ZlZWRiYWNrKSk7XG59O1xuXG5Xb3JsZC51cGRhdGVSb3V0ZXMgPSBmdW5jdGlvbiAoZ2VzdGFsdHMpIHtcbiAgICBXb3JsZC5jdXJyZW50KCkuZW5xdWV1ZUFjdGlvbihXb3JsZC5hY3RpdmVQaWQoKSwgdXBkYXRlUm91dGVzKGdlc3RhbHRzKSk7XG59O1xuXG5Xb3JsZC5zcGF3biA9IGZ1bmN0aW9uIChiZWhhdmlvcikge1xuICAgIFdvcmxkLmN1cnJlbnQoKS5lbnF1ZXVlQWN0aW9uKFdvcmxkLmFjdGl2ZVBpZCgpLCBzcGF3bihiZWhhdmlvcikpO1xufTtcblxuV29ybGQuZXhpdCA9IGZ1bmN0aW9uIChleG4pIHtcbiAgICBXb3JsZC5jdXJyZW50KCkua2lsbChXb3JsZC5hY3RpdmVQaWQoKSwgZXhuKTtcbn07XG5cbldvcmxkLnNodXRkb3duV29ybGQgPSBmdW5jdGlvbiAoKSB7XG4gICAgV29ybGQuY3VycmVudCgpLmVucXVldWVBY3Rpb24oV29ybGQuYWN0aXZlUGlkKCksIHNodXRkb3duV29ybGQoKSk7XG59O1xuXG5Xb3JsZC53aXRoV29ybGRTdGFjayA9IGZ1bmN0aW9uIChzdGFjaywgZikge1xuICAgIHZhciBvbGRTdGFjayA9IFdvcmxkLnN0YWNrO1xuICAgIFdvcmxkLnN0YWNrID0gc3RhY2s7XG4gICAgdmFyIHJlc3VsdCA9IG51bGw7XG4gICAgdHJ5IHtcblx0cmVzdWx0ID0gZigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcblx0V29ybGQuc3RhY2sgPSBvbGRTdGFjaztcblx0dGhyb3cgZTtcbiAgICB9XG4gICAgV29ybGQuc3RhY2sgPSBvbGRTdGFjaztcbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxuV29ybGQud3JhcCA9IGZ1bmN0aW9uIChmKSB7XG4gICAgdmFyIHNhdmVkU3RhY2sgPSBXb3JsZC5zdGFjay5zbGljZSgpO1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG5cdHZhciBhY3R1YWxzID0gYXJndW1lbnRzO1xuXHRyZXR1cm4gV29ybGQud2l0aFdvcmxkU3RhY2soc2F2ZWRTdGFjaywgZnVuY3Rpb24gKCkge1xuXHQgICAgdmFyIHJlc3VsdCA9IFdvcmxkLmN1cnJlbnQoKS5hc0NoaWxkKFdvcmxkLmFjdGl2ZVBpZCgpLCBmdW5jdGlvbiAoKSB7XG5cdFx0cmV0dXJuIGYuYXBwbHkobnVsbCwgYWN0dWFscyk7XG5cdCAgICB9KTtcblx0ICAgIGZvciAodmFyIGkgPSBXb3JsZC5zdGFjay5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuXHRcdFdvcmxkLnN0YWNrW2ldWzBdLm1hcmtQaWRSdW5uYWJsZShXb3JsZC5zdGFja1tpXVsxXSk7XG5cdCAgICB9XG5cdCAgICByZXR1cm4gcmVzdWx0O1xuXHR9KTtcbiAgICB9O1xufTtcblxuLyogSW5zdGFuY2UgbWV0aG9kcyAqL1xuXG5Xb3JsZC5wcm90b3R5cGUuZW5xdWV1ZUFjdGlvbiA9IGZ1bmN0aW9uIChwaWQsIGFjdGlvbikge1xuICAgIHRoaXMucHJvY2Vzc0FjdGlvbnMucHVzaChbcGlkLCBhY3Rpb25dKTtcbn07XG5cbi8vIFRoZSBjb2RlIGlzIHdyaXR0ZW4gdG8gbWFpbnRhaW4gdGhlIHJ1bm5hYmxlUGlkcyBzZXQgY2FyZWZ1bGx5LCB0b1xuLy8gZW5zdXJlIHdlIGNhbiBsb2NhbGx5IGRlY2lkZSB3aGV0aGVyIHdlJ3JlIGluZXJ0IG9yIG5vdCB3aXRob3V0XG4vLyBoYXZpbmcgdG8gc2VhcmNoIHRoZSB3aG9sZSBkZWVwIHByb2Nlc3MgdHJlZS5cbldvcmxkLnByb3RvdHlwZS5pc0luZXJ0ID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB0aGlzLmV2ZW50UXVldWUubGVuZ3RoID09PSAwXG5cdCYmIHRoaXMucHJvY2Vzc0FjdGlvbnMubGVuZ3RoID09PSAwXG5cdCYmIFJvdXRlLmlzX2VtcHR5U2V0KHRoaXMucnVubmFibGVQaWRzKTtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5tYXJrUGlkUnVubmFibGUgPSBmdW5jdGlvbiAocGlkKSB7XG4gICAgdGhpcy5ydW5uYWJsZVBpZHNbcGlkXSA9IFtwaWRdO1xufTtcblxuV29ybGQucHJvdG90eXBlLnN0ZXAgPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5kaXNwYXRjaEV2ZW50cygpO1xuICAgIHRoaXMucGVyZm9ybUFjdGlvbnMoKTtcbiAgICB0aGlzLnN0ZXBDaGlsZHJlbigpO1xuICAgIHJldHVybiB0aGlzLmFsaXZlICYmICF0aGlzLmlzSW5lcnQoKTtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5hc0NoaWxkID0gZnVuY3Rpb24gKHBpZCwgZiwgb21pdExpdmVuZXNzQ2hlY2spIHtcbiAgICBpZiAoIShwaWQgaW4gdGhpcy5wcm9jZXNzVGFibGUpICYmICFvbWl0TGl2ZW5lc3NDaGVjaykge1xuXHRjb25zb2xlLndhcm4oXCJXb3JsZC5hc0NoaWxkIGVsaWRpbmcgaW52b2NhdGlvbiBvZiBkZWFkIHByb2Nlc3NcIiwgcGlkKTtcblx0cmV0dXJuO1xuICAgIH1cblxuICAgIFdvcmxkLnN0YWNrLnB1c2goW3RoaXMsIHBpZF0pO1xuICAgIHZhciByZXN1bHQgPSBudWxsO1xuICAgIHRyeSB7XG5cdHJlc3VsdCA9IGYoKTtcbiAgICB9IGNhdGNoIChlKSB7XG5cdHRoaXMua2lsbChwaWQsIGUpO1xuICAgIH1cbiAgICBpZiAoV29ybGQuc3RhY2sucG9wKClbMF0gIT09IHRoaXMpIHtcblx0dGhyb3cgbmV3IEVycm9yKFwiSW50ZXJuYWwgZXJyb3I6IFdvcmxkIHN0YWNrIGltYmFsYW5jZVwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5raWxsID0gZnVuY3Rpb24gKHBpZCwgZXhuKSB7XG4gICAgaWYgKGV4biAmJiBleG4uc3RhY2spIHtcblx0Y29uc29sZS5sb2coXCJQcm9jZXNzIGV4aXRlZFwiLCBwaWQsIGV4biwgZXhuLnN0YWNrKTtcbiAgICB9IGVsc2Uge1xuXHRjb25zb2xlLmxvZyhcIlByb2Nlc3MgZXhpdGVkXCIsIHBpZCwgZXhuKTtcbiAgICB9XG4gICAgdmFyIHAgPSB0aGlzLnByb2Nlc3NUYWJsZVtwaWRdO1xuICAgIGRlbGV0ZSB0aGlzLnByb2Nlc3NUYWJsZVtwaWRdO1xuICAgIGlmIChwKSB7XG5cdGlmIChwLmJlaGF2aW9yLnRyYXBleGl0KSB7XG5cdCAgdGhpcy5hc0NoaWxkKHBpZCwgZnVuY3Rpb24gKCkgeyByZXR1cm4gcC5iZWhhdmlvci50cmFwZXhpdChleG4pOyB9LCB0cnVlKTtcblx0fVxuXHRpZiAoZXhuKSB7XG5cdCAgICBwLmV4aXRSZWFzb24gPSBleG47XG5cdCAgICB0aGlzLnRvbWJzdG9uZXNbcGlkXSA9IHA7XG5cdH1cblx0dGhpcy5hcHBseUFuZElzc3VlUm91dGluZ1VwZGF0ZShwLmdlc3RhbHQsIFJvdXRlLmVtcHR5R2VzdGFsdCk7XG4gICAgfVxufTtcblxuV29ybGQucHJvdG90eXBlLnN0ZXBDaGlsZHJlbiA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcGlkcyA9IHRoaXMucnVubmFibGVQaWRzO1xuICAgIHRoaXMucnVubmFibGVQaWRzID0ge307XG4gICAgZm9yICh2YXIgcGlkIGluIHBpZHMpIHtcblx0dmFyIHAgPSB0aGlzLnByb2Nlc3NUYWJsZVtwaWRdO1xuXHRpZiAocCAmJiBwLmJlaGF2aW9yLnN0ZXAgLyogZXhpc3RzLCBoYXZlbid0IGNhbGxlZCBpdCB5ZXQgKi8pIHtcblx0ICAgIHZhciBjaGlsZEJ1c3kgPSB0aGlzLmFzQ2hpbGQocGlkIHwgMCwgZnVuY3Rpb24gKCkgeyByZXR1cm4gcC5iZWhhdmlvci5zdGVwKCkgfSk7XG5cdCAgICBpZiAoY2hpbGRCdXN5KSB0aGlzLm1hcmtQaWRSdW5uYWJsZShwaWQpO1xuXHR9XG4gICAgfVxufTtcblxuV29ybGQucHJvdG90eXBlLnBlcmZvcm1BY3Rpb25zID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBxdWV1ZSA9IHRoaXMucHJvY2Vzc0FjdGlvbnM7XG4gICAgdGhpcy5wcm9jZXNzQWN0aW9ucyA9IFtdO1xuICAgIHZhciBpdGVtO1xuICAgIHdoaWxlICgoaXRlbSA9IHF1ZXVlLnNoaWZ0KCkpICYmIHRoaXMuYWxpdmUpIHtcblx0dGhpcy5wZXJmb3JtQWN0aW9uKGl0ZW1bMF0sIGl0ZW1bMV0pO1xuICAgIH1cbn07XG5cbldvcmxkLnByb3RvdHlwZS5kaXNwYXRjaEV2ZW50cyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcXVldWUgPSB0aGlzLmV2ZW50UXVldWU7XG4gICAgdGhpcy5ldmVudFF1ZXVlID0gW107XG4gICAgdmFyIGl0ZW07XG4gICAgd2hpbGUgKChpdGVtID0gcXVldWUuc2hpZnQoKSkpIHtcblx0dGhpcy5kaXNwYXRjaEV2ZW50KGl0ZW0pO1xuICAgIH1cbn07XG5cbldvcmxkLnByb3RvdHlwZS5wZXJmb3JtQWN0aW9uID0gZnVuY3Rpb24gKHBpZCwgYWN0aW9uKSB7XG4gICAgc3dpdGNoIChhY3Rpb24udHlwZSkge1xuICAgIGNhc2UgXCJzcGF3blwiOlxuXHR2YXIgcGlkID0gV29ybGQubmV4dFBpZCsrO1xuICAgICAgICB2YXIgZW50cnkgPSB7IGdlc3RhbHQ6IFJvdXRlLmVtcHR5R2VzdGFsdCwgYmVoYXZpb3I6IGFjdGlvbi5iZWhhdmlvciB9O1xuXHR0aGlzLnByb2Nlc3NUYWJsZVtwaWRdID0gZW50cnk7XG5cdGlmIChlbnRyeS5iZWhhdmlvci5ib290KSB7XG5cdCAgICB2YXIgaW5pdGlhbEdlc3RhbHRzID0gdGhpcy5hc0NoaWxkKHBpZCwgZnVuY3Rpb24gKCkgeyByZXR1cm4gZW50cnkuYmVoYXZpb3IuYm9vdCgpIH0pO1xuXHQgICAgaWYgKGluaXRpYWxHZXN0YWx0cykge1xuXHQgICAgICAgIGVudHJ5Lmdlc3RhbHQgPSBSb3V0ZS5nZXN0YWx0VW5pb24oaW5pdGlhbEdlc3RhbHRzKS5sYWJlbChwaWQpO1xuXHQgICAgfVxuXHQgICAgdGhpcy5tYXJrUGlkUnVubmFibGUocGlkKTtcblx0fVxuICAgICAgICBpZiAoIVJvdXRlLmVtcHR5R2VzdGFsdC5lcXVhbHMoZW50cnkuZ2VzdGFsdCkpIHtcblx0ICAgIHRoaXMuYXBwbHlBbmRJc3N1ZVJvdXRpbmdVcGRhdGUoUm91dGUuZW1wdHlHZXN0YWx0LCBlbnRyeS5nZXN0YWx0LCBwaWQpO1xuXHR9XG5cdGJyZWFrO1xuICAgIGNhc2UgXCJyb3V0ZXNcIjpcblx0aWYgKHBpZCBpbiB0aGlzLnByb2Nlc3NUYWJsZSkge1xuXHQgICAgLy8gaXQgbWF5IG5vdCBiZTogdGhpcyBtaWdodCBiZSB0aGUgcm91dGluZyB1cGRhdGUgZnJvbSBhXG5cdCAgICAvLyBraWxsIG9mIHRoZSBwcm9jZXNzXG5cdCAgICB2YXIgb2xkR2VzdGFsdCA9IHRoaXMucHJvY2Vzc1RhYmxlW3BpZF0uZ2VzdGFsdDtcblx0ICAgIHZhciBuZXdHZXN0YWx0ID0gYWN0aW9uLmdlc3RhbHQubGFiZWwocGlkfDApO1xuXHQgICAgLy8gXiBwaWR8MDogY29udmVydCBwaWQgZnJvbSBzdHJpbmcgKHRhYmxlIGtleSEpIHRvIGludGVnZXJcblx0ICAgIHRoaXMucHJvY2Vzc1RhYmxlW3BpZF0uZ2VzdGFsdCA9IG5ld0dlc3RhbHQ7XG5cdCAgICB0aGlzLmFwcGx5QW5kSXNzdWVSb3V0aW5nVXBkYXRlKG9sZEdlc3RhbHQsIG5ld0dlc3RhbHQsIHBpZCk7XG5cdH1cblx0YnJlYWs7XG4gICAgY2FzZSBcIm1lc3NhZ2VcIjpcblx0aWYgKGFjdGlvbi5tZXRhTGV2ZWwgPT09IDApIHtcblx0ICAgIHRoaXMuZXZlbnRRdWV1ZS5wdXNoKGFjdGlvbik7XG5cdH0gZWxzZSB7XG5cdCAgICBXb3JsZC5zZW5kKGFjdGlvbi5tZXNzYWdlLCBhY3Rpb24ubWV0YUxldmVsIC0gMSwgYWN0aW9uLmlzRmVlZGJhY2spO1xuXHR9XG5cdGJyZWFrO1xuICAgIGNhc2UgXCJzaHV0ZG93bldvcmxkXCI6XG5cdHRoaXMuYWxpdmUgPSBmYWxzZTsgLy8gZm9yY2UgdXMgdG8gc3RvcCBkb2luZyB0aGluZ3MgaW1tZWRpYXRlbHlcblx0V29ybGQuZXhpdCgpO1xuXHRicmVhaztcbiAgICBkZWZhdWx0OlxuXHR2YXIgZXhuID0gbmV3IEVycm9yKFwiQWN0aW9uIHR5cGUgXCIgKyBhY3Rpb24udHlwZSArIFwiIG5vdCB1bmRlcnN0b29kXCIpO1xuXHRleG4uYWN0aW9uID0gYWN0aW9uO1xuXHR0aHJvdyBleG47XG4gICAgfVxufTtcblxuV29ybGQucHJvdG90eXBlLnVwZGF0ZUZ1bGxHZXN0YWx0ID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVsbEdlc3RhbHQgPSB0aGlzLnBhcnRpYWxHZXN0YWx0LnVuaW9uKHRoaXMuZG93bndhcmRHZXN0YWx0KTtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5pc3N1ZUxvY2FsUm91dGluZ1VwZGF0ZSA9IGZ1bmN0aW9uIChhZmZlY3RlZFN1Ymdlc3RhbHQsIGtub3duVGFyZ2V0KSB7XG4gICAgdGhpcy5ldmVudFF1ZXVlLnB1c2gocGVuZGluZ1JvdXRpbmdVcGRhdGUodGhpcy5mdWxsR2VzdGFsdCxcblx0XHRcdFx0XHQgICAgICBhZmZlY3RlZFN1Ymdlc3RhbHQsXG5cdFx0XHRcdFx0ICAgICAga25vd25UYXJnZXQpKTtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5hcHBseUFuZElzc3VlUm91dGluZ1VwZGF0ZSA9IGZ1bmN0aW9uIChvbGRnLCBuZXdnLCBrbm93blRhcmdldCkge1xuICAgIGtub3duVGFyZ2V0ID0gdHlwZW9mIGtub3duVGFyZ2V0ID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiBrbm93blRhcmdldDtcbiAgICB0aGlzLnBhcnRpYWxHZXN0YWx0ID0gdGhpcy5wYXJ0aWFsR2VzdGFsdC5lcmFzZVBhdGgob2xkZykudW5pb24obmV3Zyk7XG4gICAgdGhpcy51cGRhdGVGdWxsR2VzdGFsdCgpO1xuICAgIHRoaXMuaXNzdWVMb2NhbFJvdXRpbmdVcGRhdGUob2xkZy51bmlvbihuZXdnKSwga25vd25UYXJnZXQpO1xuICAgIFdvcmxkLnVwZGF0ZVJvdXRlcyhbdGhpcy5wYXJ0aWFsR2VzdGFsdC5kcm9wKCldKTtcbn07XG5cbldvcmxkLnByb3RvdHlwZS5kaXNwYXRjaEV2ZW50ID0gZnVuY3Rpb24gKGUpIHtcbiAgICBzd2l0Y2ggKGUudHlwZSkge1xuICAgIGNhc2UgXCJwZW5kaW5nUm91dGluZ1VwZGF0ZVwiOlxuXHR2YXIgcGlkcyA9IGUuYWZmZWN0ZWRTdWJnZXN0YWx0Lm1hdGNoKGUuYWdncmVnYXRlKTtcblx0aWYgKGUua25vd25UYXJnZXQgIT09IG51bGwpIHBpZHMudW5zaGlmdChlLmtub3duVGFyZ2V0KTtcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBwaWRzLmxlbmd0aDsgaSsrKSB7XG5cdCAgICB2YXIgcGlkID0gcGlkc1tpXTtcblx0ICAgIGlmIChwaWQgPT09IFwib3V0XCIpIGNvbnNvbGUud2FybihcIldvdWxkIGhhdmUgZGVsaXZlcmVkIGEgcm91dGluZyB1cGRhdGUgdG8gZW52aXJvbm1lbnRcIik7XG5cdCAgICB2YXIgcCA9IHRoaXMucHJvY2Vzc1RhYmxlW3BpZF07XG5cdCAgICBpZiAocCkge1xuXHRcdHZhciBnID0gZS5hZ2dyZWdhdGUuZmlsdGVyKHAuZ2VzdGFsdCk7XG5cdFx0dGhpcy5hc0NoaWxkKHBpZCwgZnVuY3Rpb24gKCkgeyBwLmJlaGF2aW9yLmhhbmRsZUV2ZW50KHVwZGF0ZVJvdXRlcyhbZ10pKSB9KTtcblx0XHR0aGlzLm1hcmtQaWRSdW5uYWJsZShwaWQpO1xuXHQgICAgfVxuXHR9XG5cdGJyZWFrO1xuXG4gICAgY2FzZSBcIm1lc3NhZ2VcIjpcblx0dmFyIHBpZHMgPSB0aGlzLnBhcnRpYWxHZXN0YWx0Lm1hdGNoVmFsdWUoZS5tZXNzYWdlLCBlLm1ldGFMZXZlbCwgZS5pc0ZlZWRiYWNrKTtcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCBwaWRzLmxlbmd0aDsgaSsrKSB7XG5cdCAgICB2YXIgcGlkID0gcGlkc1tpXTtcblx0ICAgIHZhciBwID0gdGhpcy5wcm9jZXNzVGFibGVbcGlkXTtcblx0ICAgIHRoaXMuYXNDaGlsZChwaWQsIGZ1bmN0aW9uICgpIHsgcC5iZWhhdmlvci5oYW5kbGVFdmVudChlKSB9KTtcblx0ICAgIHRoaXMubWFya1BpZFJ1bm5hYmxlKHBpZCk7XG5cdH1cblx0YnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuXHR2YXIgZXhuID0gbmV3IEVycm9yKFwiRXZlbnQgdHlwZSBcIiArIGUudHlwZSArIFwiIG5vdCBkaXNwYXRjaGFibGVcIik7XG5cdGV4bi5ldmVudCA9IGU7XG5cdHRocm93IGV4bjtcbiAgICB9XG59O1xuXG5Xb3JsZC5wcm90b3R5cGUuYm9vdCA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gTmVlZGVkIGluIG9yZGVyIGZvciB0aGUgbmV3IFdvcmxkIHRvIGJlIG1hcmtlZCBhcyBcInJ1bm5hYmxlXCIsIHNvXG4gIC8vIGl0cyBpbml0aWFsIGFjdGlvbnMgZ2V0IHBlcmZvcm1lZC5cbn07XG5cbldvcmxkLnByb3RvdHlwZS5oYW5kbGVFdmVudCA9IGZ1bmN0aW9uIChlKSB7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICBjYXNlIFwicm91dGVzXCI6XG5cdHZhciBvbGREb3dud2FyZCA9IHRoaXMuZG93bndhcmRHZXN0YWx0O1xuXHR0aGlzLmRvd253YXJkR2VzdGFsdCA9IGUuZ2VzdGFsdC5sYWJlbChcIm91dFwiKS5saWZ0KCk7XG5cdHRoaXMudXBkYXRlRnVsbEdlc3RhbHQoKTtcblx0dGhpcy5pc3N1ZUxvY2FsUm91dGluZ1VwZGF0ZShvbGREb3dud2FyZC51bmlvbih0aGlzLmRvd253YXJkR2VzdGFsdCksIG51bGwpO1xuXHRicmVhaztcbiAgICBjYXNlIFwibWVzc2FnZVwiOlxuXHR0aGlzLmV2ZW50UXVldWUucHVzaChzZW5kTWVzc2FnZShlLm1lc3NhZ2UsIGUubWV0YUxldmVsICsgMSwgZS5pc0ZlZWRiYWNrKSk7XG5cdGJyZWFrO1xuICAgIGRlZmF1bHQ6XG5cdHZhciBleG4gPSBuZXcgRXJyb3IoXCJFdmVudCB0eXBlIFwiICsgZS50eXBlICsgXCIgbm90IHVuZGVyc3Rvb2RcIik7XG5cdGV4bi5ldmVudCA9IGU7XG5cdHRocm93IGV4bjtcbiAgICB9XG59O1xuXG4vKiBEZWJ1Z2dpbmcsIG1hbmFnZW1lbnQsIGFuZCBtb25pdG9yaW5nICovXG5cbldvcmxkLnByb3RvdHlwZS5wcm9jZXNzVHJlZSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIga2lkcyA9IFtdO1xuICAgIGZvciAodmFyIHBpZCBpbiB0aGlzLnByb2Nlc3NUYWJsZSkge1xuXHR2YXIgcCA9IHRoaXMucHJvY2Vzc1RhYmxlW3BpZF07XG5cdGlmIChwLmJlaGF2aW9yIGluc3RhbmNlb2YgV29ybGQpIHtcblx0ICAgIGtpZHMucHVzaChbcGlkLCBwLmJlaGF2aW9yLnByb2Nlc3NUcmVlKCldKTtcblx0fSBlbHNlIHtcblx0ICAgIGtpZHMucHVzaChbcGlkLCBwXSk7XG5cdH1cbiAgICB9XG4gICAgZm9yICh2YXIgcGlkIGluIHRoaXMudG9tYnN0b25lcykge1xuXHRraWRzLnB1c2goW3BpZCwgdGhpcy50b21ic3RvbmVzW3BpZF1dKTtcbiAgICB9XG4gICAga2lkcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBhWzBdIC0gYlswXSB9KTtcbiAgICByZXR1cm4ga2lkcztcbn07XG5cbldvcmxkLnByb3RvdHlwZS50ZXh0UHJvY2Vzc1RyZWUgPSBmdW5jdGlvbiAob3duUGlkKSB7XG4gICAgdmFyIGxpbmVzID0gW107XG5cbiAgICBmdW5jdGlvbiBkdW1wUHJvY2VzcyhwcmVmaXgsIHBpZCwgcCkge1xuXHRpZiAoQXJyYXkuaXNBcnJheShwKSkge1xuXHQgICAgbGluZXMucHVzaChwcmVmaXggKyAnLS0rICcgKyBwaWQpO1xuXHQgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XG5cdFx0ZHVtcFByb2Nlc3MocHJlZml4ICsgJyAgfCcsIHBbaV1bMF0sIHBbaV1bMV0pO1xuXHQgICAgfVxuXHQgICAgbGluZXMucHVzaChwcmVmaXgpO1xuXHR9IGVsc2Uge1xuXHQgICAgdmFyIGxhYmVsID0gcC5iZWhhdmlvci5uYW1lIHx8IHAuYmVoYXZpb3IuY29uc3RydWN0b3IubmFtZSB8fCAnJztcblx0ICAgIHZhciB0b21ic3RvbmVTdHJpbmcgPSBwLmV4aXRSZWFzb24gPyAnIChFWElURUQ6ICcgKyBwLmV4aXRSZWFzb24gKyAnKSAnIDogJyc7XG5cdCAgICB2YXIgc3RyaW5naWZpZWRTdGF0ZTtcblx0ICAgIHRyeSB7XG5cdCAgICAgIHZhciByYXdTdGF0ZSA9IHAuYmVoYXZpb3IuZGVidWdTdGF0ZSA/IHAuYmVoYXZpb3IuZGVidWdTdGF0ZSgpIDogcC5iZWhhdmlvcjtcblx0ICAgICAgc3RyaW5naWZpZWRTdGF0ZSA9IEpTT04uc3RyaW5naWZ5KHJhd1N0YXRlLCBmdW5jdGlvbiAoaywgdikge1xuXHRcdHJldHVybiAoayA9PT0gJ25hbWUnKSA/IHVuZGVmaW5lZCA6IHY7XG5cdCAgICAgIH0pO1xuXHQgICAgfSBjYXRjaCAoZSkge1xuXHQgICAgICBzdHJpbmdpZmllZFN0YXRlID0gXCIoY2Fubm90IGNvbnZlcnQgcHJvY2VzcyBzdGF0ZSB0byBKU09OKVwiO1xuXHQgICAgfVxuXHQgICAgbGluZXMucHVzaChwcmVmaXggKyAnLS0gJyArIHBpZCArICc6ICcgKyBsYWJlbCArIHRvbWJzdG9uZVN0cmluZyArIHN0cmluZ2lmaWVkU3RhdGUpO1xuXHR9XG4gICAgfVxuXG4gICAgZHVtcFByb2Nlc3MoJycsIG93blBpZCB8fCAnJywgdGhpcy5wcm9jZXNzVHJlZSgpKTtcbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59O1xuXG5Xb3JsZC5wcm90b3R5cGUuY2xlYXJUb21ic3RvbmVzID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMudG9tYnN0b25lcyA9IHt9O1xuICAgIGZvciAodmFyIHBpZCBpbiB0aGlzLnByb2Nlc3NUYWJsZSkge1xuXHR2YXIgcCA9IHRoaXMucHJvY2Vzc1RhYmxlW3BpZF07XG5cdGlmIChwLmJlaGF2aW9yIGluc3RhbmNlb2YgV29ybGQpIHtcblx0ICAgIHAuYmVoYXZpb3IuY2xlYXJUb21ic3RvbmVzKCk7XG5cdH1cbiAgICB9XG59O1xuXG4vKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG4vKiBVdGlsaXRpZXM6IG1hdGNoaW5nIGRlbWFuZCBmb3Igc29tZSBzZXJ2aWNlICovXG5cbmZ1bmN0aW9uIERlbWFuZE1hdGNoZXIocHJvamVjdGlvbiwgbWV0YUxldmVsLCBvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IFV0aWwuZXh0ZW5kKHtcblx0ZGVtYW5kTGV2ZWw6IDAsXG5cdHN1cHBseUxldmVsOiAwLFxuXHRkZW1hbmRTaWRlSXNTdWJzY3JpcHRpb246IGZhbHNlLFxuXHRzdXBwbHlQcm9qZWN0aW9uOiBwcm9qZWN0aW9uXG4gICAgfSwgb3B0aW9ucyk7XG4gICAgdGhpcy5kZW1hbmRQYXR0ZXJuID0gUm91dGUucHJvamVjdGlvblRvUGF0dGVybihwcm9qZWN0aW9uKTtcbiAgICB0aGlzLnN1cHBseVBhdHRlcm4gPSBSb3V0ZS5wcm9qZWN0aW9uVG9QYXR0ZXJuKG9wdGlvbnMuc3VwcGx5UHJvamVjdGlvbik7XG4gICAgdGhpcy5kZW1hbmRQcm9qZWN0aW9uU3BlYyA9IFJvdXRlLmNvbXBpbGVQcm9qZWN0aW9uKHByb2plY3Rpb24pO1xuICAgIHRoaXMuc3VwcGx5UHJvamVjdGlvblNwZWMgPSBSb3V0ZS5jb21waWxlUHJvamVjdGlvbihvcHRpb25zLnN1cHBseVByb2plY3Rpb24pO1xuICAgIHRoaXMubWV0YUxldmVsID0gbWV0YUxldmVsIHwgMDtcbiAgICB0aGlzLmRlbWFuZExldmVsID0gb3B0aW9ucy5kZW1hbmRMZXZlbDtcbiAgICB0aGlzLnN1cHBseUxldmVsID0gb3B0aW9ucy5zdXBwbHlMZXZlbDtcbiAgICB0aGlzLmRlbWFuZFNpZGVJc1N1YnNjcmlwdGlvbiA9IG9wdGlvbnMuZGVtYW5kU2lkZUlzU3Vic2NyaXB0aW9uO1xuICAgIHRoaXMub25EZW1hbmRJbmNyZWFzZSA9IGZ1bmN0aW9uIChjYXB0dXJlcykge1xuXHRjb25zb2xlLmVycm9yKFwiVW5oYW5kbGVkIGluY3JlYXNlIGluIGRlbWFuZCBmb3Igcm91dGVcIiwgY2FwdHVyZXMpO1xuICAgIH07XG4gICAgdGhpcy5vblN1cHBseURlY3JlYXNlID0gZnVuY3Rpb24gKGNhcHR1cmVzKSB7XG5cdGNvbnNvbGUuZXJyb3IoXCJVbmhhbmRsZWQgZGVjcmVhc2UgaW4gc3VwcGx5IGZvciByb3V0ZVwiLCBjYXB0dXJlcyk7XG4gICAgfTtcbiAgICB0aGlzLmN1cnJlbnREZW1hbmQgPSB7fTtcbiAgICB0aGlzLmN1cnJlbnRTdXBwbHkgPSB7fTtcbn1cblxuRGVtYW5kTWF0Y2hlci5wcm90b3R5cGUuZGVidWdTdGF0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICBkZW1hbmRQYXR0ZXJuOiB0aGlzLmRlbWFuZFBhdHRlcm4sXG4gICAgc3VwcGx5UGF0dGVybjogdGhpcy5zdXBwbHlQYXR0ZXJuLFxuICAgIG1ldGFMZXZlbDogdGhpcy5tZXRhTGV2ZWwsXG4gICAgZGVtYW5kTGV2ZWw6IHRoaXMuZGVtYW5kTGV2ZWwsXG4gICAgc3VwcGx5TGV2ZWw6IHRoaXMuc3VwcGx5TGV2ZWwsXG4gICAgZGVtYW5kU2lkZUlzU3Vic2NyaXB0aW9uOiB0aGlzLmRlbWFuZFNpZGVJc1N1YnNjcmlwdGlvblxuXG4gICAgLy8gLCBjdXJyZW50RGVtYW5kOiB0aGlzLmN1cnJlbnREZW1hbmRcbiAgICAvLyAsIGN1cnJlbnRTdXBwbHk6IHRoaXMuY3VycmVudFN1cHBseVxuICB9O1xufTtcblxuRGVtYW5kTWF0Y2hlci5wcm90b3R5cGUuYm9vdCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgb2JzZXJ2ZXJMZXZlbCA9IDEgKyBNYXRoLm1heCh0aGlzLmRlbWFuZExldmVsLCB0aGlzLnN1cHBseUxldmVsKTtcbiAgICByZXR1cm4gW3N1Yih0aGlzLmRlbWFuZFBhdHRlcm4sIHRoaXMubWV0YUxldmVsLCBvYnNlcnZlckxldmVsKSxcblx0ICAgIHB1Yih0aGlzLnN1cHBseVBhdHRlcm4sIHRoaXMubWV0YUxldmVsLCBvYnNlcnZlckxldmVsKV07XG59O1xuXG5EZW1hbmRNYXRjaGVyLnByb3RvdHlwZS5oYW5kbGVFdmVudCA9IGZ1bmN0aW9uIChlKSB7XG4gICAgaWYgKGUudHlwZSA9PT0gXCJyb3V0ZXNcIikge1xuXHR0aGlzLmhhbmRsZUdlc3RhbHQoZS5nZXN0YWx0KTtcbiAgICB9XG59O1xuXG5EZW1hbmRNYXRjaGVyLnByb3RvdHlwZS5oYW5kbGVHZXN0YWx0ID0gZnVuY3Rpb24gKGdlc3RhbHQpIHtcbiAgICB2YXIgbmV3RGVtYW5kTWF0Y2hlciA9IGdlc3RhbHQucHJvamVjdCh0aGlzLmRlbWFuZFByb2plY3Rpb25TcGVjLFxuXHRcdFx0XHRcdCAgICF0aGlzLmRlbWFuZFNpZGVJc1N1YnNjcmlwdGlvbixcblx0XHRcdFx0XHQgICB0aGlzLm1ldGFMZXZlbCxcblx0XHRcdFx0XHQgICB0aGlzLmRlbWFuZExldmVsKTtcbiAgICB2YXIgbmV3U3VwcGx5TWF0Y2hlciA9IGdlc3RhbHQucHJvamVjdCh0aGlzLnN1cHBseVByb2plY3Rpb25TcGVjLFxuXHRcdFx0XHRcdCAgIHRoaXMuZGVtYW5kU2lkZUlzU3Vic2NyaXB0aW9uLFxuXHRcdFx0XHRcdCAgIHRoaXMubWV0YUxldmVsLFxuXHRcdFx0XHRcdCAgIHRoaXMuc3VwcGx5TGV2ZWwpO1xuICAgIHZhciBuZXdEZW1hbmQgPSBSb3V0ZS5hcnJheVRvU2V0KFJvdXRlLm1hdGNoZXJLZXlzKG5ld0RlbWFuZE1hdGNoZXIpKTtcbiAgICB2YXIgbmV3U3VwcGx5ID0gUm91dGUuYXJyYXlUb1NldChSb3V0ZS5tYXRjaGVyS2V5cyhuZXdTdXBwbHlNYXRjaGVyKSk7XG4gICAgdmFyIGRlbWFuZERlbHRhID0gUm91dGUuc2V0U3VidHJhY3QobmV3RGVtYW5kLCB0aGlzLmN1cnJlbnREZW1hbmQpO1xuICAgIHZhciBzdXBwbHlEZWx0YSA9IFJvdXRlLnNldFN1YnRyYWN0KHRoaXMuY3VycmVudFN1cHBseSwgbmV3U3VwcGx5KTtcbiAgICB2YXIgZGVtYW5kSW5jciA9IFJvdXRlLnNldFN1YnRyYWN0KGRlbWFuZERlbHRhLCBuZXdTdXBwbHkpO1xuICAgIHZhciBzdXBwbHlEZWNyID0gUm91dGUuc2V0SW50ZXJzZWN0KHN1cHBseURlbHRhLCBuZXdEZW1hbmQpO1xuICAgIHRoaXMuY3VycmVudERlbWFuZCA9IG5ld0RlbWFuZDtcbiAgICB0aGlzLmN1cnJlbnRTdXBwbHkgPSBuZXdTdXBwbHk7XG4gICAgZm9yICh2YXIgayBpbiBkZW1hbmRJbmNyKSB0aGlzLm9uRGVtYW5kSW5jcmVhc2UoZGVtYW5kSW5jcltrXSk7XG4gICAgZm9yICh2YXIgayBpbiBzdXBwbHlEZWNyKSB0aGlzLm9uU3VwcGx5RGVjcmVhc2Uoc3VwcGx5RGVjcltrXSk7XG59O1xuXG4vKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG4vKiBVdGlsaXRpZXM6IGRlZHVwbGljYXRvciAqL1xuXG5mdW5jdGlvbiBEZWR1cGxpY2F0b3IodHRsX21zKSB7XG4gICAgdGhpcy50dGxfbXMgPSB0dGxfbXMgfHwgMTAwMDA7XG4gICAgdGhpcy5xdWV1ZSA9IFtdO1xuICAgIHRoaXMubWFwID0ge307XG4gICAgdGhpcy50aW1lcklkID0gbnVsbDtcbn1cblxuRGVkdXBsaWNhdG9yLnByb3RvdHlwZS5hY2NlcHQgPSBmdW5jdGlvbiAobSkge1xuICAgIHZhciBzID0gSlNPTi5zdHJpbmdpZnkobSk7XG4gICAgaWYgKHMgaW4gdGhpcy5tYXApIHJldHVybiBmYWxzZTtcbiAgICB2YXIgZW50cnkgPSBbKCtuZXcgRGF0ZSgpKSArIHRoaXMudHRsX21zLCBzLCBtXTtcbiAgICB0aGlzLm1hcFtzXSA9IGVudHJ5O1xuICAgIHRoaXMucXVldWUucHVzaChlbnRyeSk7XG5cbiAgICBpZiAodGhpcy50aW1lcklkID09PSBudWxsKSB7XG5cdHZhciBzZWxmID0gdGhpcztcblx0dGhpcy50aW1lcklkID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkgeyBzZWxmLmV4cGlyZU1lc3NhZ2VzKCk7IH0sXG5cdFx0XHRcdCAgIHRoaXMudHRsX21zID4gMTAwMCA/IDEwMDAgOiB0aGlzLnR0bF9tcyk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufTtcblxuRGVkdXBsaWNhdG9yLnByb3RvdHlwZS5leHBpcmVNZXNzYWdlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgbm93ID0gK25ldyBEYXRlKCk7XG4gICAgd2hpbGUgKHRoaXMucXVldWUubGVuZ3RoID4gMCAmJiB0aGlzLnF1ZXVlWzBdWzBdIDw9IG5vdykge1xuXHR2YXIgZW50cnkgPSB0aGlzLnF1ZXVlLnNoaWZ0KCk7XG5cdGRlbGV0ZSB0aGlzLm1hcFtlbnRyeVsxXV07XG4gICAgfVxuICAgIGlmICh0aGlzLnF1ZXVlLmxlbmd0aCA9PT0gMCkge1xuXHRjbGVhckludGVydmFsKHRoaXMudGltZXJJZCk7XG5cdHRoaXMudGltZXJJZCA9IG51bGw7XG4gICAgfVxufTtcblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbm1vZHVsZS5leHBvcnRzLl9fID0gX187XG5tb2R1bGUuZXhwb3J0cy5fJCA9IF8kO1xuXG5tb2R1bGUuZXhwb3J0cy5zdWIgPSBzdWI7XG5tb2R1bGUuZXhwb3J0cy5wdWIgPSBwdWI7XG5tb2R1bGUuZXhwb3J0cy5zcGF3biA9IHNwYXduO1xubW9kdWxlLmV4cG9ydHMudXBkYXRlUm91dGVzID0gdXBkYXRlUm91dGVzO1xubW9kdWxlLmV4cG9ydHMuc2VuZE1lc3NhZ2UgPSBzZW5kTWVzc2FnZTtcbm1vZHVsZS5leHBvcnRzLnNodXRkb3duV29ybGQgPSBzaHV0ZG93bldvcmxkO1xuXG5tb2R1bGUuZXhwb3J0cy5Xb3JsZCA9IFdvcmxkO1xubW9kdWxlLmV4cG9ydHMuRGVtYW5kTWF0Y2hlciA9IERlbWFuZE1hdGNoZXI7XG5tb2R1bGUuZXhwb3J0cy5EZWR1cGxpY2F0b3IgPSBEZWR1cGxpY2F0b3I7XG5tb2R1bGUuZXhwb3J0cy5Sb3V0ZSA9IFJvdXRlO1xuIiwiLy8gUmVmbGVjdGlvbiBvbiBmdW5jdGlvbiBmb3JtYWwgcGFyYW1ldGVyIGxpc3RzLlxuLy8gVGhpcyBtb2R1bGUgaXMgYmFzZWQgb24gQW5ndWxhcidzIFwiaW5qZWN0b3JcIiBjb2RlLFxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci5qcy9ibG9iL21hc3Rlci9zcmMvYXV0by9pbmplY3Rvci5qcyxcbi8vIE1JVCBsaWNlbnNlZCwgYW5kIGhlbmNlOlxuLy8gQ29weXJpZ2h0IChjKSAyMDEwLTIwMTQgR29vZ2xlLCBJbmMuIGh0dHA6Ly9hbmd1bGFyanMub3JnXG4vLyBDb3B5cmlnaHQgKGMpIDIwMTQgVG9ueSBHYXJub2NrLUpvbmVzXG5cbnZhciBGTl9BUkdTID0gL15mdW5jdGlvblxccypbXlxcKF0qXFwoXFxzKihbXlxcKV0qKVxcKS9tO1xudmFyIEZOX0FSR19TUExJVCA9IC8sLztcbnZhciBTVFJJUF9DT01NRU5UUyA9IC8oKFxcL1xcLy4qJCl8KFxcL1xcKltcXHNcXFNdKj9cXCpcXC8pKS9tZztcblxuZnVuY3Rpb24gZm9ybWFsUGFyYW1ldGVycyhmbikge1xuICAgIHZhciByZXN1bHQgPSBbXTtcblxuICAgIHZhciBmblRleHQgPSBmbi50b1N0cmluZygpLnJlcGxhY2UoU1RSSVBfQ09NTUVOVFMsICcnKTtcbiAgICB2YXIgYXJnRGVjbCA9IGZuVGV4dC5tYXRjaChGTl9BUkdTKTtcbiAgICB2YXIgYXJncyA9IGFyZ0RlY2xbMV0uc3BsaXQoRk5fQVJHX1NQTElUKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcblx0dmFyIHRyaW1tZWQgPSBhcmdzW2ldLnRyaW0oKTtcblx0aWYgKHRyaW1tZWQpIHsgcmVzdWx0LnB1c2godHJpbW1lZCk7IH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cy5mb3JtYWxQYXJhbWV0ZXJzID0gZm9ybWFsUGFyYW1ldGVycztcbiIsInZhciBfXyA9IFwiX19cIjsgLyogd2lsZGNhcmQgbWFya2VyICovXG5cbnZhciBTT0EgPSBcIl9fW1wiOyAvLyBzdGFydCBvZiBhcnJheVxudmFyIEVPQSA9IFwiX19dXCI7IC8vIGVuZCBvZiBhcnJheVxuXG5mdW5jdGlvbiBkaWUobWVzc2FnZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKTtcbn1cblxuZnVuY3Rpb24gJEVtYmVkZGVkKG1hdGNoZXIpIHtcbiAgICB0aGlzLm1hdGNoZXIgPSBtYXRjaGVyO1xufVxuXG5mdW5jdGlvbiBlbWJlZGRlZE1hdGNoZXIobWF0Y2hlcikge1xuICAgIHJldHVybiBuZXcgJEVtYmVkZGVkKG1hdGNoZXIpO1xufVxuXG4vLyBUaGUgbmFtZSBhcmd1bWVudCBzaG91bGQgYmUgYSBzdHJpbmcgb3IgbnVsbDsgaXQgZGVmYXVsdHMgdG8gbnVsbC5cbi8vIFRoZSBwYXR0ZXJuIGFyZ3VtZW50IGRlZmF1bHRzIHRvIHdpbGRjYXJkLCBfXy5cbmZ1bmN0aW9uICRDYXB0dXJlKG5hbWUsIHBhdHRlcm4pIHtcbiAgICB0aGlzLm5hbWUgPSBuYW1lIHx8IG51bGw7XG4gICAgdGhpcy5wYXR0ZXJuID0gKHR5cGVvZiBwYXR0ZXJuID09PSAndW5kZWZpbmVkJyA/IF9fIDogcGF0dGVybik7XG59XG5cbi8vIEFiYnJldmlhdGlvbjogXyQoLi4uKSA8PT0+IG5ldyAkQ2FwdHVyZSguLi4pXG5mdW5jdGlvbiBfJChuYW1lLCBwYXR0ZXJuKSB7XG4gICAgcmV0dXJuIG5ldyAkQ2FwdHVyZShuYW1lLCBwYXR0ZXJuKTtcbn1cblxuZnVuY3Rpb24gaXNDYXB0dXJlKHgpIHsgcmV0dXJuIHggaW5zdGFuY2VvZiAkQ2FwdHVyZSB8fCB4ID09PSBfJDsgfVxuZnVuY3Rpb24gY2FwdHVyZU5hbWUoeCkgeyByZXR1cm4geCBpbnN0YW5jZW9mICRDYXB0dXJlID8geC5uYW1lIDogbnVsbDsgfVxuZnVuY3Rpb24gY2FwdHVyZVBhdHRlcm4oeCkgeyByZXR1cm4geCBpbnN0YW5jZW9mICRDYXB0dXJlID8geC5wYXR0ZXJuIDogX187IH1cblxudmFyIFNPQyA9IFwiX197e1wiOyAvLyBzdGFydCBvZiBjYXB0dXJlXG52YXIgRU9DID0gXCJfX319XCI7IC8vIGVuZCBvZiBjYXB0dXJlXG5cbmZ1bmN0aW9uICRTdWNjZXNzKHZhbHVlKSB7XG4gICAgdGhpcy52YWx1ZSA9IHZhbHVlO1xufVxuXG5mdW5jdGlvbiAkV2lsZGNhcmRTZXF1ZW5jZShtYXRjaGVyKSB7XG4gICAgdGhpcy5tYXRjaGVyID0gbWF0Y2hlcjtcbn1cblxuZnVuY3Rpb24gJERpY3QoKSB7XG4gICAgdGhpcy5sZW5ndGggPSAwO1xuICAgIHRoaXMuZW50cmllcyA9IHt9O1xufVxuXG4kRGljdC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiB0aGlzLmVudHJpZXNba2V5XSB8fCBlbXB0eU1hdGNoZXI7XG59O1xuXG4kRGljdC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKGtleSwgdmFsKSB7XG4gICAgaWYgKCEoa2V5IGluIHRoaXMuZW50cmllcykpIHRoaXMubGVuZ3RoKys7XG4gICAgdGhpcy5lbnRyaWVzW2tleV0gPSB2YWw7XG59O1xuXG4kRGljdC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgaWYgKGtleSBpbiB0aGlzLmVudHJpZXMpIHRoaXMubGVuZ3RoLS07XG4gICAgZGVsZXRlIHRoaXMuZW50cmllc1trZXldO1xufTtcblxuJERpY3QucHJvdG90eXBlLmlzRW1wdHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMubGVuZ3RoID09PSAwO1xufTtcblxuJERpY3QucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIG90aGVyID0gbmV3ICREaWN0KCk7XG4gICAgb3RoZXIubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gICAgZm9yICh2YXIga2V5IGluIHRoaXMuZW50cmllcykge1xuXHRpZiAodGhpcy5lbnRyaWVzLmhhc093blByb3BlcnR5KGtleSkpIHtcblx0ICAgIG90aGVyLmVudHJpZXNba2V5XSA9IHRoaXMuZW50cmllc1trZXldO1xuXHR9XG4gICAgfVxuICAgIHJldHVybiBvdGhlcjtcbn07XG5cbiREaWN0LnByb3RvdHlwZS5lbXB0eUd1YXJkID0gZnVuY3Rpb24gKCkge1xuICAgIGlmICh0aGlzLmlzRW1wdHkoKSkgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbiREaWN0LnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgcmV0dXJuIGtleSBpbiB0aGlzLmVudHJpZXM7XG59O1xuXG4kRGljdC5wcm90b3R5cGUuc29ydGVkS2V5cyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIga3MgPSBbXTtcbiAgICBmb3IgKHZhciBrIGluIHRoaXMuZW50cmllcykga3MucHVzaChrKTtcbiAgICBrcy5zb3J0KCk7XG4gICAgcmV0dXJuIGtzO1xufVxuXG5mdW5jdGlvbiBpc19lbXB0eU1hdGNoZXIobSkge1xuICAgIHJldHVybiAobSA9PT0gZW1wdHlNYXRjaGVyKTtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vLyBDb25zdHJ1Y3RvcnNcblxudmFyIGVtcHR5TWF0Y2hlciA9IG51bGw7XG5cbmZ1bmN0aW9uIHJzdWNjZXNzKHYpIHtcbiAgICByZXR1cm4gKHYgPT09IGVtcHR5TWF0Y2hlcikgPyBlbXB0eU1hdGNoZXIgOiBuZXcgJFN1Y2Nlc3Modik7XG59XG5cbmZ1bmN0aW9uIHJzZXEoZSwgcikge1xuICAgIGlmIChyID09PSBlbXB0eU1hdGNoZXIpIHJldHVybiBlbXB0eU1hdGNoZXI7XG4gICAgdmFyIHMgPSBuZXcgJERpY3QoKTtcbiAgICBzLnNldChlLCByKTtcbiAgICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gcndpbGQocikge1xuICAgIHJldHVybiByc2VxKF9fLCByKTtcbn1cblxuZnVuY3Rpb24gcndpbGRzZXEocikge1xuICAgIHJldHVybiAociA9PT0gZW1wdHlNYXRjaGVyKSA/IGVtcHR5TWF0Y2hlciA6IG5ldyAkV2lsZGNhcmRTZXF1ZW5jZShyKTtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbmZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHYsIHApIHtcbiAgICBpZiAoIXApIGRpZShcImNvbXBpbGVQYXR0ZXJuOiBtaXNzaW5nIHBhdHRlcm5cIik7XG4gICAgcmV0dXJuIHdhbGsocCwgcnNlcShFT0EsIHJzdWNjZXNzKHYpKSk7XG5cbiAgICBmdW5jdGlvbiB3YWxrKHAsIGFjYykge1xuXHRpZiAocCA9PT0gX18pIHJldHVybiByd2lsZChhY2MpO1xuXG5cdGlmIChBcnJheS5pc0FycmF5KHApKSB7XG5cdCAgICBhY2MgPSByc2VxKEVPQSwgYWNjKTtcblx0ICAgIGZvciAodmFyIGkgPSBwLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG5cdFx0YWNjID0gd2FsayhwW2ldLCBhY2MpO1xuXHQgICAgfVxuXHQgICAgcmV0dXJuIHJzZXEoU09BLCBhY2MpO1xuXHR9XG5cblx0aWYgKHAgaW5zdGFuY2VvZiAkRW1iZWRkZWQpIHtcblx0ICAgIHJldHVybiBhcHBlbmRNYXRjaGVyKHAubWF0Y2hlciwgZnVuY3Rpb24gKHYpIHsgcmV0dXJuIGFjYzsgfSk7XG5cdH0gZWxzZSB7XG5cdCAgICByZXR1cm4gcnNlcShKU09OLnN0cmluZ2lmeShwKSwgYWNjKTtcblx0fVxuICAgIH1cbn1cblxuZnVuY3Rpb24gbWF0Y2hQYXR0ZXJuKHYsIHApIHtcbiAgICB2YXIgY2FwdHVyZUNvdW50ID0gMDtcbiAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgdHJ5IHtcblx0d2Fsayh2LCBwKTtcbiAgICB9IGNhdGNoIChlKSB7XG5cdGlmIChlLm1hdGNoUGF0dGVybkZhaWxlZCkgcmV0dXJuIG51bGw7XG5cdHRocm93IGU7XG4gICAgfVxuICAgIHJlc3VsdC5sZW5ndGggPSBjYXB0dXJlQ291bnQ7XG4gICAgcmV0dXJuIHJlc3VsdDtcblxuICAgIGZ1bmN0aW9uIHdhbGsodiwgcCkge1xuXHRpZiAocCA9PT0gdikgcmV0dXJuO1xuXG5cdGlmIChwID09PSBfXykgcmV0dXJuO1xuXG5cdGlmIChBcnJheS5pc0FycmF5KHApICYmIEFycmF5LmlzQXJyYXkodikgJiYgcC5sZW5ndGggPT09IHYubGVuZ3RoKSB7XG5cdCAgICBmb3IgKHZhciBpID0gMDsgaSA8IHAubGVuZ3RoOyBpKyspIHtcblx0XHR3YWxrKHZbaV0sIHBbaV0pO1xuXHQgICAgfVxuXHQgICAgcmV0dXJuO1xuXHR9XG5cblx0aWYgKGlzQ2FwdHVyZShwKSkge1xuXHQgICAgdmFyIHRoaXNDYXB0dXJlID0gY2FwdHVyZUNvdW50Kys7XG5cdCAgICB3YWxrKHYsIGNhcHR1cmVQYXR0ZXJuKHApKTtcblx0ICAgIHJlc3VsdFtjYXB0dXJlTmFtZShwKSB8fCAoJyQnICsgdGhpc0NhcHR1cmUpXSA9IHY7XG5cdCAgICByZXR1cm47XG5cdH1cblxuXHRpZiAocCBpbnN0YW5jZW9mICRFbWJlZGRlZCkge1xuXHQgICAgZGllKFwiJEVtYmVkZGVkIHBhdHRlcm5zIG5vdCBzdXBwb3J0ZWQgaW4gbWF0Y2hQYXR0ZXJuKClcIik7XG5cdH1cblxuXHR0aHJvdyB7bWF0Y2hQYXR0ZXJuRmFpbGVkOiB0cnVlfTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHNoYWxsb3dDb3B5QXJyYXkocykge1xuICAgIHJldHVybiBzLnNsaWNlKCk7XG59XG5cbmZ1bmN0aW9uIHJ1cGRhdGVJbnBsYWNlKHIsIGtleSwgaykge1xuICAgIGlmIChpc19lbXB0eU1hdGNoZXIoaykpIHtcblx0ci5jbGVhcihrZXkpO1xuICAgIH0gZWxzZSB7XG5cdHIuc2V0KGtleSwgayk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBtYXRjaGVyRXF1YWxzKGEsIGIpIHtcbiAgICBpZiAoYSA9PT0gbnVsbCkge1xuXHRyZXR1cm4gKGIgPT09IG51bGwpO1xuICAgIH1cbiAgICBpZiAoYiA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuXG4gICAgaWYgKGEgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHRpZiAoIShiIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpKSByZXR1cm4gZmFsc2U7XG5cdGEgPSBhLm1hdGNoZXI7XG5cdGIgPSBiLm1hdGNoZXI7XG4gICAgfSBlbHNlIGlmIChiIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHJldHVybiBmYWxzZTtcblxuICAgIGlmIChhIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0aWYgKCEoYiBpbnN0YW5jZW9mICRTdWNjZXNzKSkgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdmFsdWVzRXF1YWwoYS52YWx1ZSwgYi52YWx1ZSk7XG4gICAgfVxuICAgIGlmIChiIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHJldHVybiBmYWxzZTtcblxuICAgIGZvciAodmFyIGtleSBpbiBhLmVudHJpZXMpIHtcblx0aWYgKCFiLmhhcyhrZXkpKSByZXR1cm4gZmFsc2U7XG5cdGlmICghbWF0Y2hlckVxdWFscyhhLmVudHJpZXNba2V5XSwgYi5lbnRyaWVzW2tleV0pKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpc19rZXlPcGVuKGspIHtcbiAgICByZXR1cm4gayA9PT0gU09BO1xufVxuXG5mdW5jdGlvbiBpc19rZXlDbG9zZShrKSB7XG4gICAgcmV0dXJuIGsgPT09IEVPQTtcbn1cblxuZnVuY3Rpb24gaXNfa2V5Tm9ybWFsKGspIHtcbiAgICByZXR1cm4gIShpc19rZXlPcGVuKGspIHx8IGlzX2tleUNsb3NlKGspKTtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG4vLyBFbm91Z2ggb2Ygc2V0cyB0byBnZXQgYnkgd2l0aFxuXG5mdW5jdGlvbiBhcnJheVRvU2V0KHhzKSB7XG4gICAgdmFyIHMgPSB7fTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG5cdHNbSlNPTi5zdHJpbmdpZnkoeHNbaV0pXSA9IHhzW2ldO1xuICAgIH1cbiAgICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gc2V0VG9BcnJheShzKSB7XG4gICAgdmFyIHIgPSBbXTtcbiAgICBmb3IgKHZhciBrIGluIHMpIHIucHVzaChzW2tdKTtcbiAgICByZXR1cm4gcjtcbn1cblxuZnVuY3Rpb24gc2V0VW5pb24oczEsIHMyKSB7XG4gICAgdmFyIHMgPSB7fTtcbiAgICBzZXRVbmlvbklucGxhY2UocywgczEpO1xuICAgIHNldFVuaW9uSW5wbGFjZShzLCBzMik7XG4gICAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIGlzX2VtcHR5U2V0KHMpIHtcbiAgICBmb3IgKHZhciBrIGluIHMpIHtcblx0aWYgKHMuaGFzT3duUHJvcGVydHkoaykpXG5cdCAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0cmFjdChzMSwgczIpIHtcbiAgICB2YXIgcyA9IHt9O1xuICAgIGZvciAodmFyIGtleSBpbiBzMSkge1xuXHRpZiAoczEuaGFzT3duUHJvcGVydHkoa2V5KSAmJiAhczIuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuXHQgICAgc1trZXldID0gczFba2V5XTtcblx0fVxuICAgIH1cbiAgICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gc2V0SW50ZXJzZWN0KHMxLCBzMikge1xuICAgIHZhciBzID0ge307XG4gICAgZm9yICh2YXIga2V5IGluIHMxKSB7XG5cdGlmIChzMS5oYXNPd25Qcm9wZXJ0eShrZXkpICYmIHMyLmhhc093blByb3BlcnR5KGtleSkpIHtcblx0ICAgIHNba2V5XSA9IHMxW2tleV07XG5cdH1cbiAgICB9XG4gICAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIHNldFVuaW9uSW5wbGFjZShhY2MsIHMpIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gcykge1xuXHRpZiAocy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG5cdCAgICBhY2Nba2V5XSA9IHNba2V5XTtcblx0fVxuICAgIH1cbn1cblxuZnVuY3Rpb24gc2V0RXF1YWwoczEsIHMyKSB7XG4gICAgZm9yICh2YXIga2V5IGluIHMxKSB7XG5cdGlmIChzMS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG5cdCAgICBpZiAoczFba2V5XSAhPT0gczJba2V5XSkgcmV0dXJuIGZhbHNlO1xuXHR9XG4gICAgfVxuICAgIGZvciAodmFyIGtleSBpbiBzMikge1xuXHRpZiAoczIuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuXHQgICAgaWYgKHMxW2tleV0gIT09IHMyW2tleV0pIHJldHVybiBmYWxzZTtcblx0fVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbnZhciB1bmlvblN1Y2Nlc3NlcyA9IGZ1bmN0aW9uICh2MSwgdjIpIHtcbiAgICBpZiAodjEgPT09IHRydWUpIHJldHVybiB2MjtcbiAgICBpZiAodjIgPT09IHRydWUpIHJldHVybiB2MTtcbiAgICByZXR1cm4gc2V0VW5pb24odjEsIHYyKTtcbn07XG5cbnZhciBpbnRlcnNlY3RTdWNjZXNzZXMgPSBmdW5jdGlvbiAodjEsIHYyKSB7XG4gICAgcmV0dXJuIHYxO1xufTtcblxudmFyIGVyYXNlUGF0aFN1Y2Nlc3NlcyA9IGZ1bmN0aW9uICh2MSwgdjIpIHtcbiAgICB2YXIgciA9IHNldFN1YnRyYWN0KHYxLCB2Mik7XG4gICAgaWYgKGlzX2VtcHR5U2V0KHIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gcjtcbn07XG5cbnZhciBtYXRjaE1hdGNoZXJTdWNjZXNzZXMgPSBmdW5jdGlvbiAodjEsIHYyLCBhY2MpIHtcbiAgICBzZXRVbmlvbklucGxhY2UoYWNjLCB2Mik7XG59O1xuXG52YXIgcHJvamVjdFN1Y2Nlc3MgPSBmdW5jdGlvbiAodikge1xuICAgIHJldHVybiB2O1xufTtcblxudmFyIHZhbHVlc0VxdWFsID0gZnVuY3Rpb24gKGEsIGIpIHtcbiAgICByZXR1cm4gc2V0RXF1YWwoYSwgYik7XG59O1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuZnVuY3Rpb24gZXhwYW5kV2lsZHNlcShyKSB7XG4gICAgcmV0dXJuIHVuaW9uKHJ3aWxkKHJ3aWxkc2VxKHIpKSwgcnNlcShFT0EsIHIpKTtcbn1cblxuZnVuY3Rpb24gdW5pb24obzEsIG8yKSB7XG4gICAgcmV0dXJuIG1lcmdlKG8xLCBvMik7XG5cbiAgICBmdW5jdGlvbiBtZXJnZShvMSwgbzIpIHtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcihvMSkpIHJldHVybiBvMjtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcihvMikpIHJldHVybiBvMTtcblx0cmV0dXJuIHdhbGsobzEsIG8yKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3YWxrKHIxLCByMikge1xuXHRpZiAocjEgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHQgICAgaWYgKHIyIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0XHRyZXR1cm4gcndpbGRzZXEod2FsayhyMS5tYXRjaGVyLCByMi5tYXRjaGVyKSk7XG5cdCAgICB9XG5cdCAgICByMSA9IGV4cGFuZFdpbGRzZXEocjEubWF0Y2hlcik7XG5cdH0gZWxzZSBpZiAocjIgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHQgICAgcjIgPSBleHBhbmRXaWxkc2VxKHIyLm1hdGNoZXIpO1xuXHR9XG5cblx0aWYgKHIxIGluc3RhbmNlb2YgJFN1Y2Nlc3MgJiYgcjIgaW5zdGFuY2VvZiAkU3VjY2Vzcykge1xuXHQgICAgcmV0dXJuIHJzdWNjZXNzKHVuaW9uU3VjY2Vzc2VzKHIxLnZhbHVlLCByMi52YWx1ZSkpO1xuXHR9XG5cblx0dmFyIHcgPSBtZXJnZShyMS5nZXQoX18pLCByMi5nZXQoX18pKTtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcih3KSkge1xuXHQgICAgdmFyIHNtYWxsZXIgPSByMS5sZW5ndGggPCByMi5sZW5ndGggPyByMSA6IHIyO1xuXHQgICAgdmFyIGxhcmdlciAgPSByMS5sZW5ndGggPCByMi5sZW5ndGggPyByMiA6IHIxO1xuXHQgICAgdmFyIHRhcmdldCA9IGxhcmdlci5jb3B5KCk7XG5cdCAgICBmb3IgKHZhciBrZXkgaW4gc21hbGxlci5lbnRyaWVzKSB7XG5cdFx0dmFyIGsgPSBtZXJnZShzbWFsbGVyLmdldChrZXkpLCBsYXJnZXIuZ2V0KGtleSkpO1xuXHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCBrKTtcblx0ICAgIH1cblx0ICAgIHJldHVybiB0YXJnZXQuZW1wdHlHdWFyZCgpO1xuXHR9IGVsc2Uge1xuXHQgICAgZnVuY3Rpb24gZXhhbWluZUtleShyQSwga2V5LCByQikge1xuXHRcdGlmICgoa2V5ICE9PSBfXykgJiYgIXRhcmdldC5oYXMoa2V5KSkge1xuXHRcdCAgICB2YXIgayA9IG1lcmdlKHJBLmdldChrZXkpLCByQi5nZXQoa2V5KSk7XG5cdFx0ICAgIGlmIChpc19rZXlPcGVuKGtleSkpIHtcblx0XHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCBtZXJnZShyd2lsZHNlcSh3KSwgaykpO1xuXHRcdCAgICB9IGVsc2UgaWYgKGlzX2tleUNsb3NlKGtleSkpIHtcblx0XHRcdGlmICh3IGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0XHRcdCAgICBydXBkYXRlSW5wbGFjZSh0YXJnZXQsIGtleSwgbWVyZ2Uody5tYXRjaGVyLCBrKSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0ICAgIHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCBrKTtcblx0XHRcdH1cblx0XHQgICAgfSBlbHNlIHtcblx0XHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCBtZXJnZSh3LCBrKSk7XG5cdFx0ICAgIH1cblx0XHR9XG5cdCAgICB9XG5cdCAgICB2YXIgdGFyZ2V0ID0gcndpbGQodykuY29weSgpO1xuXHQgICAgZm9yICh2YXIga2V5IGluIHIxLmVudHJpZXMpIHsgZXhhbWluZUtleShyMSwga2V5LCByMik7IH1cblx0ICAgIGZvciAodmFyIGtleSBpbiByMi5lbnRyaWVzKSB7IGV4YW1pbmVLZXkocjIsIGtleSwgcjEpOyB9XG5cdCAgICByZXR1cm4gdGFyZ2V0O1xuXHR9XG4gICAgfVxufVxuXG5mdW5jdGlvbiB1bmlvbk4oKSB7XG4gICAgdmFyIGFjYyA9IGVtcHR5TWF0Y2hlcjtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuXHRhY2MgPSB1bmlvbihhY2MsIGFyZ3VtZW50c1tpXSk7XG4gICAgfVxuICAgIHJldHVybiBhY2M7XG59XG5cbmZ1bmN0aW9uIGludGVyc2VjdChvMSwgbzIpIHtcbiAgICBpZiAoaXNfZW1wdHlNYXRjaGVyKG8xKSkgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcbiAgICBpZiAoaXNfZW1wdHlNYXRjaGVyKG8yKSkgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcbiAgICByZXR1cm4gd2FsayhvMSwgbzIpO1xuXG4gICAgZnVuY3Rpb24gd2Fsa0ZsaXBwZWQocjIsIHIxKSB7IHJldHVybiB3YWxrKHIxLCByMik7IH1cblxuICAgIGZ1bmN0aW9uIHdhbGsocjEsIHIyKSB7XG5cdC8vIElOVkFSSUFOVDogcjEgaXMgYSBwYXJ0IG9mIHRoZSBvcmlnaW5hbCBvMSwgYW5kXG5cdC8vIGxpa2V3aXNlIGZvciByMi4gVGhpcyBpcyBzbyB0aGF0IHRoZSBmaXJzdCBhcmcgdG9cblx0Ly8gaW50ZXJzZWN0U3VjY2Vzc2VzIGFsd2F5cyBjb21lcyBmcm9tIHIxLCBhbmQgdGhlIHNlY29uZFxuXHQvLyBmcm9tIHIyLlxuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKHIxKSkgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcihyMikpIHJldHVybiBlbXB0eU1hdGNoZXI7XG5cblx0aWYgKHIxIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIGlmIChyMiBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB7XG5cdFx0cmV0dXJuIHJ3aWxkc2VxKHdhbGsocjEubWF0Y2hlciwgcjIubWF0Y2hlcikpO1xuXHQgICAgfVxuXHQgICAgcjEgPSBleHBhbmRXaWxkc2VxKHIxLm1hdGNoZXIpO1xuXHR9IGVsc2UgaWYgKHIyIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIHIyID0gZXhwYW5kV2lsZHNlcShyMi5tYXRjaGVyKTtcblx0fVxuXG5cdGlmIChyMSBpbnN0YW5jZW9mICRTdWNjZXNzICYmIHIyIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0ICAgIHJldHVybiByc3VjY2VzcyhpbnRlcnNlY3RTdWNjZXNzZXMocjEudmFsdWUsIHIyLnZhbHVlKSk7XG5cdH1cblxuXHR2YXIgdzEgPSByMS5nZXQoX18pO1xuXHR2YXIgdzIgPSByMi5nZXQoX18pO1xuXHR2YXIgdyA9IHdhbGsodzEsIHcyKTtcblxuXHR2YXIgdGFyZ2V0ID0gbmV3ICREaWN0KCk7XG5cblx0ZnVuY3Rpb24gZXhhbWluZUtleShrZXkpIHtcblx0ICAgIGlmICgoa2V5ICE9PSBfXykgJiYgIXRhcmdldC5oYXMoa2V5KSkge1xuXHRcdHZhciBrMSA9IHIxLmdldChrZXkpO1xuXHRcdHZhciBrMiA9IHIyLmdldChrZXkpO1xuXHRcdGlmIChpc19lbXB0eU1hdGNoZXIoazEpKSB7XG5cdFx0ICAgIGlmIChpc19lbXB0eU1hdGNoZXIoazIpKSB7XG5cdFx0XHRydXBkYXRlSW5wbGFjZSh0YXJnZXQsIGtleSwgZW1wdHlNYXRjaGVyKTtcblx0XHQgICAgfSBlbHNlIHtcblx0XHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCB3YWxrV2lsZCh3YWxrLCB3MSwga2V5LCBrMikpO1xuXHRcdCAgICB9XG5cdFx0fSBlbHNlIHtcblx0XHQgICAgaWYgKGlzX2VtcHR5TWF0Y2hlcihrMikpIHtcblx0XHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCB3YWxrV2lsZCh3YWxrRmxpcHBlZCwgdzIsIGtleSwgazEpKTtcblx0XHQgICAgfSBlbHNlIHtcblx0XHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCB3YWxrKGsxLCBrMikpO1xuXHRcdCAgICB9XG5cdFx0fVxuXHQgICAgfVxuXHR9XG5cblx0aWYgKGlzX2VtcHR5TWF0Y2hlcih3MSkpIHtcblx0ICAgIGlmIChpc19lbXB0eU1hdGNoZXIodzIpKSB7XG5cdFx0Zm9yICh2YXIga2V5IGluIChyMS5sZW5ndGggPCByMi5sZW5ndGggPyByMSA6IHIyKS5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdCAgICB9IGVsc2Uge1xuXHRcdGZvciAodmFyIGtleSBpbiByMS5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdCAgICB9XG5cdH0gZWxzZSB7XG5cdCAgICBpZiAoaXNfZW1wdHlNYXRjaGVyKHcyKSkge1xuXHRcdGZvciAodmFyIGtleSBpbiByMi5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwgX18sIHcpO1xuXHRcdGZvciAodmFyIGtleSBpbiByMS5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdFx0Zm9yICh2YXIga2V5IGluIHIyLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0ICAgIH1cblx0fVxuXHRyZXR1cm4gdGFyZ2V0LmVtcHR5R3VhcmQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3YWxrV2lsZCh3YWxrZXIsIHcsIGtleSwgaykge1xuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKHcpKSByZXR1cm4gZW1wdHlNYXRjaGVyO1xuXHRpZiAoaXNfa2V5T3BlbihrZXkpKSByZXR1cm4gd2Fsa2VyKHJ3aWxkc2VxKHcpLCBrKTtcblx0aWYgKGlzX2tleUNsb3NlKGtleSkpIHtcblx0ICAgIGlmICh3IGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHJldHVybiB3YWxrZXIody5tYXRjaGVyLCBrKTtcblx0ICAgIHJldHVybiBlbXB0eU1hdGNoZXI7XG5cdH1cblx0cmV0dXJuIHdhbGtlcih3LCBrKTtcbiAgICB9XG59XG5cbi8vIFJlbW92ZXMgcjIncyBtYXBwaW5ncyBmcm9tIHIxLiBBc3N1bWVzIHIyIGhhcyBwcmV2aW91c2x5IGJlZW5cbi8vIHVuaW9uJ2QgaW50byByMS4gVGhlIGVyYXNlUGF0aFN1Y2Nlc3NlcyBmdW5jdGlvbiBzaG91bGQgcmV0dXJuXG4vLyBudWxsIHRvIHNpZ25hbCBcIm5vIHJlbWFpbmluZyBzdWNjZXNzIHZhbHVlc1wiLlxuZnVuY3Rpb24gZXJhc2VQYXRoKG8xLCBvMikge1xuICAgIHJldHVybiB3YWxrKG8xLCBvMik7XG5cbiAgICBmdW5jdGlvbiB3YWxrKHIxLCByMikge1xuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKHIxKSkge1xuXHQgICAgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcblx0fSBlbHNlIHtcblx0ICAgIGlmIChpc19lbXB0eU1hdGNoZXIocjIpKSB7XG5cdFx0cmV0dXJuIHIxO1xuXHQgICAgfVxuXHR9XG5cblx0aWYgKHIxIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIGlmIChyMiBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB7XG5cdFx0cmV0dXJuIHJ3aWxkc2VxKHdhbGsocjEubWF0Y2hlciwgcjIubWF0Y2hlcikpO1xuXHQgICAgfVxuXHQgICAgcjEgPSBleHBhbmRXaWxkc2VxKHIxLm1hdGNoZXIpO1xuXHR9IGVsc2UgaWYgKHIyIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIHIyID0gZXhwYW5kV2lsZHNlcShyMi5tYXRjaGVyKTtcblx0fVxuXG5cdGlmIChyMSBpbnN0YW5jZW9mICRTdWNjZXNzICYmIHIyIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0ICAgIHJldHVybiByc3VjY2VzcyhlcmFzZVBhdGhTdWNjZXNzZXMocjEudmFsdWUsIHIyLnZhbHVlKSk7XG5cdH1cblxuXHR2YXIgdzEgPSByMS5nZXQoX18pO1xuXHR2YXIgdzIgPSByMi5nZXQoX18pO1xuXHR2YXIgdyA9IHdhbGsodzEsIHcyKTtcblx0dmFyIHRhcmdldDtcblxuXHRmdW5jdGlvbiBleGFtaW5lS2V5KGtleSkge1xuXHQgICAgaWYgKGtleSAhPT0gX18pIHtcblx0XHR2YXIgazEgPSByMS5nZXQoa2V5KTtcblx0XHR2YXIgazIgPSByMi5nZXQoa2V5KTtcblx0XHR2YXIgdXBkYXRlZEs7XG5cdFx0aWYgKGlzX2VtcHR5TWF0Y2hlcihrMikpIHtcblx0XHQgICAgdXBkYXRlZEsgPSB3YWxrV2lsZChrZXksIGsxLCB3Mik7XG5cdFx0fSBlbHNlIHtcblx0XHQgICAgdXBkYXRlZEsgPSB3YWxrKGsxLCBrMik7XG5cdFx0fVxuXHRcdC8vIEhlcmUgd2UgZW5zdXJlIGEgXCJtaW5pbWFsXCIgcmVtYWluZGVyIGluIGNhc2VzXG5cdFx0Ly8gd2hlcmUgYWZ0ZXIgYW4gZXJhc3VyZSwgYSBwYXJ0aWN1bGFyIGtleSdzXG5cdFx0Ly8gY29udGludWF0aW9uIGlzIHRoZSBzYW1lIGFzIHRoZSB3aWxkY2FyZCdzXG5cdFx0Ly8gY29udGludWF0aW9uLiBUT0RPOiB0aGUgbWF0Y2hlckVxdWFscyBjaGVjayBtYXlcblx0XHQvLyBiZSBleHBlbnNpdmUuIElmIHNvLCBob3cgY2FuIGl0IGJlIG1hZGVcblx0XHQvLyBjaGVhcGVyP1xuXHRcdGlmIChpc19rZXlPcGVuKGtleSkpIHtcblx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksXG5cdFx0XHRcdCAgICgodXBkYXRlZEsgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkgJiZcblx0XHRcdFx0ICAgIG1hdGNoZXJFcXVhbHModXBkYXRlZEsubWF0Y2hlciwgdykpXG5cdFx0XHRcdCAgID8gZW1wdHlNYXRjaGVyXG5cdFx0XHRcdCAgIDogdXBkYXRlZEspO1xuXHRcdH0gZWxzZSBpZiAoaXNfa2V5Q2xvc2Uoa2V5KSkge1xuXHRcdCAgICAvLyBXZSB0YWtlIGNhcmUgb2YgdGhpcyBjYXNlIGxhdGVyLCBhZnRlciB0aGVcblx0XHQgICAgLy8gdGFyZ2V0IGlzIGZ1bGx5IGNvbnN0cnVjdGVkL3JlYnVpbHQuXG5cdFx0ICAgIHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCB1cGRhdGVkSyk7XG5cdFx0fSBlbHNlIHtcblx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksXG5cdFx0XHRcdCAgIChtYXRjaGVyRXF1YWxzKHVwZGF0ZWRLLCB3KSA/IGVtcHR5TWF0Y2hlciA6IHVwZGF0ZWRLKSk7XG5cdFx0fVxuXHQgICAgfVxuXHR9XG5cblx0aWYgKGlzX2VtcHR5TWF0Y2hlcih3MikpIHtcblx0ICAgIHRhcmdldCA9IHIxLmNvcHkoKTtcblx0ICAgIGZvciAodmFyIGtleSBpbiByMi5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdH0gZWxzZSB7XG5cdCAgICB0YXJnZXQgPSBuZXcgJERpY3QoKTtcblx0ICAgIHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwgX18sIHcpO1xuXHQgICAgZm9yICh2YXIga2V5IGluIHIxLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0ICAgIGZvciAodmFyIGtleSBpbiByMi5lbnRyaWVzKSBleGFtaW5lS2V5KGtleSk7XG5cdH1cblxuXHQvLyBIZXJlLCB0aGUgdGFyZ2V0IGlzIGNvbXBsZXRlLiBJZiBpdCBoYXMgb25seSB0d28ga2V5cyxcblx0Ly8gb25lIHdpbGQgYW5kIG9uZSBpc19rZXlDbG9zZSwgYW5kIHdpbGQncyBjb250aW51YXRpb25cblx0Ly8gaXMgYSAkV2lsZGNhcmRTZXF1ZW5jZSBhbmQgdGhlIG90aGVyIGNvbnRpbnVhdGlvbiBpc1xuXHQvLyBpZGVudGljYWwgdG8gdGhlIHNlcXVlbmNlJ3MgY29udGludWF0aW9uLCB0aGVuIHJlcGxhY2Vcblx0Ly8gdGhlIHdob2xlIHRoaW5nIHdpdGggYSBuZXN0ZWQgJFdpbGRjYXJkU2VxdWVuY2UuXG5cdC8vIChXZSBrbm93IHcgPT09IHRhcmdldC5nZXQoX18pIGZyb20gYmVmb3JlLilcblx0Ly9cblx0Ly8gVE9ETzogSSBzdXNwZWN0IGFjdHVhbGx5IHRoaXMgYXBwbGllcyBldmVuIGlmIHRoZXJlIGFyZVxuXHQvLyBtb3JlIHRoYW4gdHdvIGtleXMsIHNvIGxvbmcgYXMgYWxsIHRoZWlyIGNvbnRpbnVhdGlvbnNcblx0Ly8gYXJlIGlkZW50aWNhbCBhbmQgdGhlcmUncyBhdCBsZWFzdCBvbmUgaXNfa2V5Q2xvc2Vcblx0Ly8gYWxvbmdzaWRlIGEgd2lsZC5cblx0aWYgKHRhcmdldC5sZW5ndGggPT09IDIpIHtcblx0ICAgIHZhciBmaW5hbFcgPSB0YXJnZXQuZ2V0KF9fKTtcblx0ICAgIGlmIChmaW5hbFcgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHRcdGZvciAodmFyIGtleSBpbiB0YXJnZXQuZW50cmllcykge1xuXHRcdCAgICBpZiAoKGtleSAhPT0gX18pICYmIGlzX2tleUNsb3NlKGtleSkpIHtcblx0XHRcdHZhciBrID0gdGFyZ2V0LmdldChrZXkpO1xuXHRcdFx0aWYgKG1hdGNoZXJFcXVhbHMoaywgZmluYWxXLm1hdGNoZXIpKSB7XG5cdFx0XHQgICAgcmV0dXJuIGZpbmFsVztcblx0XHRcdH1cblx0XHQgICAgfVxuXHRcdH1cblx0ICAgIH1cblx0fVxuXG5cdHJldHVybiB0YXJnZXQuZW1wdHlHdWFyZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdhbGtXaWxkKGtleSwgaywgdykge1xuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKHcpKSByZXR1cm4gaztcblx0aWYgKGlzX2tleU9wZW4oa2V5KSkgcmV0dXJuIHdhbGsoaywgcndpbGRzZXEodykpO1xuXHRpZiAoaXNfa2V5Q2xvc2Uoa2V5KSkge1xuXHQgICAgaWYgKHcgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkgcmV0dXJuIHdhbGsoaywgdy5tYXRjaGVyKTtcblx0ICAgIHJldHVybiBrO1xuXHR9XG5cdHJldHVybiB3YWxrKGssIHcpO1xuICAgIH1cbn1cblxuLy8gUmV0dXJucyBudWxsIG9uIGZhaWxlZCBtYXRjaCwgb3RoZXJ3aXNlIHRoZSBhcHByb3ByaWF0ZSBzdWNjZXNzXG4vLyB2YWx1ZSBjb250YWluZWQgaW4gdGhlIG1hdGNoZXIgci5cbmZ1bmN0aW9uIG1hdGNoVmFsdWUociwgdikge1xuICAgIHZhciBmYWlsdXJlUmVzdWx0ID0gbnVsbDtcblxuICAgIHZhciB2cyA9IFt2XTtcbiAgICB2YXIgc3RhY2sgPSBbW11dO1xuXG4gICAgd2hpbGUgKCFpc19lbXB0eU1hdGNoZXIocikpIHtcblx0aWYgKHIgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHQgICAgaWYgKHN0YWNrLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhaWx1cmVSZXN1bHQ7XG5cdCAgICB2cyA9IHN0YWNrLnBvcCgpO1xuXHQgICAgciA9IHIubWF0Y2hlcjtcblx0ICAgIGNvbnRpbnVlO1xuXHR9XG5cblx0aWYgKHIgaW5zdGFuY2VvZiAkU3VjY2Vzcykge1xuXHQgICAgaWYgKHZzLmxlbmd0aCA9PT0gMCAmJiBzdGFjay5sZW5ndGggPT09IDApIHJldHVybiByLnZhbHVlO1xuXHQgICAgcmV0dXJuIGZhaWx1cmVSZXN1bHQ7XG5cdH1cblxuXHRpZiAodnMubGVuZ3RoID09PSAwKSB7XG5cdCAgICBpZiAoc3RhY2subGVuZ3RoID09PSAwKSByZXR1cm4gZmFpbHVyZVJlc3VsdDtcblx0ICAgIHZzID0gc3RhY2sucG9wKCk7XG5cdCAgICByID0gci5nZXQoRU9BKTtcblx0ICAgIGNvbnRpbnVlO1xuXHR9XG5cblx0dmFyIHYgPSB2cy5zaGlmdCgpO1xuXG5cdGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycgJiYgdi5zdWJzdHJpbmcoMCwgMikgPT09ICdfXycpIHtcblx0ICAgIGRpZShcIkNhbm5vdCBtYXRjaCBzcGVjaWFsIHN0cmluZyBzdGFydGluZyB3aXRoIF9fXCIpO1xuXHR9XG5cblx0aWYgKEFycmF5LmlzQXJyYXkodikpIHtcblx0ICAgIGlmIChTT0EgaW4gci5lbnRyaWVzKSB7XG5cdFx0ciA9IHIuZ2V0KFNPQSk7XG5cdFx0c3RhY2sucHVzaCh2cyk7XG5cdFx0dnMgPSBzaGFsbG93Q29weUFycmF5KHYpO1xuXHQgICAgfSBlbHNlIHtcblx0XHRyID0gci5nZXQoX18pO1xuXHQgICAgfVxuXHR9IGVsc2Uge1xuXHQgICAgdmFyIGtleTtcblx0ICAgIHRyeSB7XG5cdFx0a2V5ID0gSlNPTi5zdHJpbmdpZnkodik7XG5cdCAgICB9IGNhdGNoIChleG4pIHtcblx0XHQvLyBGb3IgZXhhbXBsZSwgdiBtaWdodCBiZSBjeWNsaWMsIGFzIGluIERPTSBldmVudHMuXG5cdFx0a2V5ID0gbnVsbDtcblx0ICAgIH1cblx0ICAgIGlmIChrZXkgaW4gci5lbnRyaWVzKSB7XG5cdFx0ciA9IHIuZ2V0KGtleSk7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHIgPSByLmdldChfXyk7XG5cdCAgICB9XG5cdH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFpbHVyZVJlc3VsdDtcbn1cblxuLy8gVE9ETzogYmV0dGVyIG5hbWUgZm9yIHRoaXNcbmZ1bmN0aW9uIG1hdGNoTWF0Y2hlcihvMSwgbzIsIHNlZWQpIHtcbiAgICB2YXIgYWNjID0gdHlwZW9mIHNlZWQgPT09ICd1bmRlZmluZWQnID8ge30gOiBzZWVkOyAvLyB3aWxsIGJlIG1vZGlmaWVkIGluIHBsYWNlXG4gICAgd2FsayhvMSwgbzIpO1xuICAgIHJldHVybiBhY2M7XG5cbiAgICBmdW5jdGlvbiB3YWxrRmxpcHBlZChyMiwgcjEpIHsgcmV0dXJuIHdhbGsocjEsIHIyKTsgfVxuXG4gICAgZnVuY3Rpb24gd2FsayhyMSwgcjIpIHtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcihyMSkgfHwgaXNfZW1wdHlNYXRjaGVyKHIyKSkgcmV0dXJuO1xuXG5cdGlmIChyMSBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB7XG5cdCAgICBpZiAocjIgaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHRcdHdhbGsocjEubWF0Y2hlciwgcjIubWF0Y2hlcik7XG5cdFx0cmV0dXJuO1xuXHQgICAgfVxuXHQgICAgcjEgPSBleHBhbmRXaWxkc2VxKHIxLm1hdGNoZXIpO1xuXHR9IGVsc2UgaWYgKHIyIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIHIyID0gZXhwYW5kV2lsZHNlcShyMi5tYXRjaGVyKTtcblx0fVxuXG5cdGlmIChyMSBpbnN0YW5jZW9mICRTdWNjZXNzICYmIHIyIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0ICAgIG1hdGNoTWF0Y2hlclN1Y2Nlc3NlcyhyMS52YWx1ZSwgcjIudmFsdWUsIGFjYyk7XG5cdCAgICByZXR1cm47XG5cdH1cblxuXHR2YXIgdzEgPSByMS5nZXQoX18pO1xuXHR2YXIgdzIgPSByMi5nZXQoX18pO1xuXHR3YWxrKHcxLCB3Mik7XG5cblx0ZnVuY3Rpb24gZXhhbWluZUtleShrZXkpIHtcblx0ICAgIGlmIChrZXkgIT09IF9fKSB7XG5cdFx0dmFyIGsxID0gcjEuZ2V0KGtleSk7XG5cdFx0dmFyIGsyID0gcjIuZ2V0KGtleSk7XG5cdFx0aWYgKGlzX2VtcHR5TWF0Y2hlcihrMSkpIHtcblx0XHQgICAgaWYgKGlzX2VtcHR5TWF0Y2hlcihrMikpIHtcblx0XHRcdHJldHVybjtcblx0XHQgICAgfSBlbHNlIHtcblx0XHRcdHdhbGtXaWxkKHdhbGssIHcxLCBrZXksIGsyKTtcblx0XHQgICAgfVxuXHRcdH0gZWxzZSB7XG5cdFx0ICAgIGlmIChpc19lbXB0eU1hdGNoZXIoazIpKSB7XG5cdFx0XHR3YWxrV2lsZCh3YWxrRmxpcHBlZCwgdzIsIGtleSwgazEpO1xuXHRcdCAgICB9IGVsc2Uge1xuXHRcdFx0d2FsayhrMSwgazIpO1xuXHRcdCAgICB9XG5cdFx0fVxuXHQgICAgfVxuXHR9XG5cblx0Ly8gT3B0aW1pemUgc2ltaWxhcmx5IHRvIGludGVyc2VjdCgpLlxuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKHcxKSkge1xuXHQgICAgaWYgKGlzX2VtcHR5TWF0Y2hlcih3MikpIHtcblx0XHRmb3IgKHZhciBrZXkgaW4gKHIxLmxlbmd0aCA8IHIyLmxlbmd0aCA/IHIxIDogcjIpLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0ICAgIH0gZWxzZSB7XG5cdFx0Zm9yICh2YXIga2V5IGluIHIxLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0ICAgIH1cblx0fSBlbHNlIHtcblx0ICAgIGlmIChpc19lbXB0eU1hdGNoZXIodzIpKSB7XG5cdFx0Zm9yICh2YXIga2V5IGluIHIyLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0ICAgIH0gZWxzZSB7XG5cdFx0Zm9yICh2YXIga2V5IGluIHIxLmVudHJpZXMpIGV4YW1pbmVLZXkoa2V5KTtcblx0XHRmb3IgKHZhciBrZXkgaW4gcjIuZW50cmllcykgZXhhbWluZUtleShrZXkpO1xuXHQgICAgfVxuXHR9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2Fsa1dpbGQod2Fsa2VyLCB3LCBrZXksIGspIHtcblx0aWYgKGlzX2VtcHR5TWF0Y2hlcih3KSkgcmV0dXJuO1xuXHRpZiAoaXNfa2V5T3BlbihrZXkpKSB7XG5cdCAgICB3YWxrZXIocndpbGRzZXEodyksIGspO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cdGlmIChpc19rZXlDbG9zZShrZXkpKSB7XG5cdCAgICBpZiAodyBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB3YWxrZXIody5tYXRjaGVyLCBrKTtcblx0ICAgIHJldHVybjtcblx0fVxuXHR3YWxrZXIodywgayk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRNYXRjaGVyKG0sIG1UYWlsRm4pIHtcbiAgICByZXR1cm4gd2FsayhtKTtcblxuICAgIGZ1bmN0aW9uIHdhbGsobSkge1xuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKG0pKSByZXR1cm4gZW1wdHlNYXRjaGVyO1xuXHRpZiAobSBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSByZXR1cm4gcndpbGRzZXEod2FsayhtLm1hdGNoZXIpKTtcblx0aWYgKG0gaW5zdGFuY2VvZiAkU3VjY2VzcykgZGllKFwiSWxsLWZvcm1lZCBtYXRjaGVyXCIpO1xuXG5cdHZhciB0YXJnZXQgPSBuZXcgJERpY3QoKTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgdmFyIGsgPSBtLmdldChrZXkpO1xuXHQgICAgaWYgKGlzX2tleUNsb3NlKGtleSkgJiYgKGsgaW5zdGFuY2VvZiAkU3VjY2VzcykpIHtcblx0XHR0YXJnZXQgPSB1bmlvbih0YXJnZXQsIG1UYWlsRm4oay52YWx1ZSkpO1xuXHQgICAgfSBlbHNlIHtcblx0XHRydXBkYXRlSW5wbGFjZSh0YXJnZXQsIGtleSwgd2FsayhrKSk7XG5cdCAgICB9XG5cdH1cblx0cmV0dXJuIHRhcmdldC5lbXB0eUd1YXJkKCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiByZWxhYmVsKG0sIGYpIHtcbiAgICByZXR1cm4gd2FsayhtKTtcblxuICAgIGZ1bmN0aW9uIHdhbGsobSkge1xuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKG0pKSByZXR1cm4gZW1wdHlNYXRjaGVyO1xuXHRpZiAobSBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSByZXR1cm4gcndpbGRzZXEod2FsayhtLm1hdGNoZXIpKTtcblx0aWYgKG0gaW5zdGFuY2VvZiAkU3VjY2VzcykgcmV0dXJuIHJzdWNjZXNzKGYobS52YWx1ZSkpO1xuXG5cdHZhciB0YXJnZXQgPSBuZXcgJERpY3QoKTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksIHdhbGsobS5nZXQoa2V5KSkpO1xuXHR9XG5cdHJldHVybiB0YXJnZXQuZW1wdHlHdWFyZCgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY29tcGlsZVByb2plY3Rpb24oLyogcHJvamVjdGlvbiwgcHJvamVjdGlvbiwgLi4uICovKSB7XG4gICAgdmFyIG5hbWVzID0gW107XG4gICAgdmFyIGFjYyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG5cdHdhbGsoYXJndW1lbnRzW2ldKTtcbiAgICB9XG4gICAgYWNjLnB1c2goRU9BKTtcbiAgICByZXR1cm4ge25hbWVzOiBuYW1lcywgc3BlYzogYWNjfTtcblxuICAgIGZ1bmN0aW9uIHdhbGsocCkge1xuXHRpZiAoaXNDYXB0dXJlKHApKSB7XG5cdCAgICBuYW1lcy5wdXNoKGNhcHR1cmVOYW1lKHApKTtcblx0ICAgIGFjYy5wdXNoKFNPQyk7XG5cdCAgICB3YWxrKGNhcHR1cmVQYXR0ZXJuKHApKTtcblx0ICAgIGFjYy5wdXNoKEVPQyk7XG5cdCAgICByZXR1cm47XG5cdH1cblxuXHRpZiAoQXJyYXkuaXNBcnJheShwKSkge1xuXHQgICAgYWNjLnB1c2goU09BKTtcblx0ICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcC5sZW5ndGg7IGkrKykge1xuXHRcdHdhbGsocFtpXSk7XG5cdCAgICB9XG5cdCAgICBhY2MucHVzaChFT0EpO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cblx0aWYgKHAgaW5zdGFuY2VvZiAkRW1iZWRkZWQpIHtcblx0ICAgIGRpZShcIkNhbm5vdCBlbWJlZCBtYXRjaGVyIGluIHByb2plY3Rpb25cIik7XG5cdH0gZWxzZSB7XG5cdCAgICBpZiAocCA9PT0gX18pIHtcblx0XHRhY2MucHVzaChwKTtcblx0ICAgIH0gZWxzZSB7XG5cdFx0YWNjLnB1c2goSlNPTi5zdHJpbmdpZnkocCkpO1xuXHQgICAgfVxuXHR9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwcm9qZWN0aW9uVG9QYXR0ZXJuKHApIHtcbiAgICByZXR1cm4gd2FsayhwKTtcblxuICAgIGZ1bmN0aW9uIHdhbGsocCkge1xuXHRpZiAoaXNDYXB0dXJlKHApKSByZXR1cm4gd2FsayhjYXB0dXJlUGF0dGVybihwKSk7XG5cblx0aWYgKEFycmF5LmlzQXJyYXkocCkpIHtcblx0ICAgIHZhciByZXN1bHQgPSBbXTtcblx0ICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcC5sZW5ndGg7IGkrKykge1xuXHRcdHJlc3VsdC5wdXNoKHdhbGsocFtpXSkpO1xuXHQgICAgfVxuXHQgICAgcmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdGlmIChwIGluc3RhbmNlb2YgJEVtYmVkZGVkKSB7XG5cdCAgICByZXR1cm4gcC5tYXRjaGVyO1xuXHR9IGVsc2Uge1xuXHQgICAgcmV0dXJuIHA7XG5cdH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHByb2plY3QobSwgY29tcGlsZWRQcm9qZWN0aW9uKSB7XG4gICAgdmFyIHNwZWMgPSBjb21waWxlZFByb2plY3Rpb24uc3BlYztcbiAgICByZXR1cm4gd2FsayhmYWxzZSwgbSwgMCk7XG5cbiAgICBmdW5jdGlvbiB3YWxrKGlzQ2FwdHVyaW5nLCBtLCBzcGVjSW5kZXgpIHtcblx0aWYgKHNwZWNJbmRleCA+PSBzcGVjLmxlbmd0aCkge1xuXHQgICAgaWYgKGlzQ2FwdHVyaW5nKSBkaWUoXCJCYWQgc3BlY2lmaWNhdGlvbjogdW5jbG9zZWQgY2FwdHVyZVwiKTtcblx0ICAgIGlmIChtIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0XHRyZXR1cm4gcnNlcShFT0EsIHJzdWNjZXNzKHByb2plY3RTdWNjZXNzKG0udmFsdWUpKSk7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHJldHVybiBlbXB0eU1hdGNoZXI7XG5cdCAgICB9XG5cdH1cblxuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKG0pKSByZXR1cm4gZW1wdHlNYXRjaGVyO1xuXG5cdHZhciBpdGVtID0gc3BlY1tzcGVjSW5kZXhdO1xuXHR2YXIgbmV4dEluZGV4ID0gc3BlY0luZGV4ICsgMTtcblxuXHRpZiAoaXRlbSA9PT0gRU9DKSB7XG5cdCAgICBpZiAoIWlzQ2FwdHVyaW5nKSBkaWUoXCJCYWQgc3BlY2lmaWNhdGlvbjogdW5lcHhlY3RlZCBFT0NcIik7XG5cdCAgICByZXR1cm4gd2FsayhmYWxzZSwgbSwgbmV4dEluZGV4KTtcblx0fVxuXG5cdGlmIChpdGVtID09PSBTT0MpIHtcblx0ICAgIGlmIChpc0NhcHR1cmluZykgZGllKFwiQmFkIHNwZWNpZmljYXRpb246IG5lc3RlZCBjYXB0dXJlXCIpO1xuXHQgICAgcmV0dXJuIHdhbGsodHJ1ZSwgbSwgbmV4dEluZGV4KTtcblx0fVxuXG5cdGlmIChpdGVtID09PSBfXykge1xuXHQgICAgaWYgKG0gaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHRcdGlmIChpc0NhcHR1cmluZykge1xuXHRcdCAgICByZXR1cm4gcndpbGQod2Fsayhpc0NhcHR1cmluZywgbSwgbmV4dEluZGV4KSk7XG5cdFx0fSBlbHNlIHtcblx0XHQgICAgcmV0dXJuIHdhbGsoaXNDYXB0dXJpbmcsIG0sIG5leHRJbmRleCk7XG5cdFx0fVxuXHQgICAgfVxuXG5cdCAgICBpZiAobSBpbnN0YW5jZW9mICRTdWNjZXNzKSB7XG5cdFx0cmV0dXJuIGVtcHR5TWF0Y2hlcjtcblx0ICAgIH1cblxuXHQgICAgdmFyIHRhcmdldDtcblx0ICAgIGlmIChpc0NhcHR1cmluZykge1xuXHRcdHRhcmdldCA9IG5ldyAkRGljdCgpO1xuXHRcdHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwgX18sIHdhbGsoaXNDYXB0dXJpbmcsIG0uZ2V0KF9fKSwgbmV4dEluZGV4KSk7XG5cdFx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHRcdCAgICBpZiAoa2V5ICE9PSBfXykge1xuXHRcdFx0dmFyIG1rID0gbS5nZXQoa2V5KTtcblx0XHRcdGlmIChpc19rZXlPcGVuKGtleSkpIHtcblx0XHRcdCAgICBmdW5jdGlvbiBjb250KG1rMikgeyByZXR1cm4gd2Fsayhpc0NhcHR1cmluZywgbWsyLCBuZXh0SW5kZXgpOyB9XG5cdFx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksIGNhcHR1cmVOZXN0ZWQobWssIGNvbnQpKTtcblx0XHRcdH0gZWxzZSBpZiAoaXNfa2V5Q2xvc2Uoa2V5KSkge1xuXHRcdFx0ICAgIC8vIGRvIG5vdGhpbmdcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksIHdhbGsoaXNDYXB0dXJpbmcsIG1rLCBuZXh0SW5kZXgpKTtcblx0XHRcdH1cblx0XHQgICAgfVxuXHRcdH1cblx0ICAgIH0gZWxzZSB7XG5cdFx0dGFyZ2V0ID0gd2Fsayhpc0NhcHR1cmluZywgbS5nZXQoX18pLCBuZXh0SW5kZXgpO1xuXHRcdGZvciAodmFyIGtleSBpbiBtLmVudHJpZXMpIHtcblx0XHQgICAgaWYgKGtleSAhPT0gX18pIHtcblx0XHRcdHZhciBtayA9IG0uZ2V0KGtleSk7XG5cdFx0XHRpZiAoaXNfa2V5T3BlbihrZXkpKSB7XG5cdFx0XHQgICAgZnVuY3Rpb24gY29udChtazIpIHsgcmV0dXJuIHdhbGsoaXNDYXB0dXJpbmcsIG1rMiwgbmV4dEluZGV4KTsgfVxuXHRcdFx0ICAgIHRhcmdldCA9IHVuaW9uKHRhcmdldCwgc2tpcE5lc3RlZChtaywgY29udCkpO1xuXHRcdFx0fSBlbHNlIGlmIChpc19rZXlDbG9zZShrZXkpKSB7XG5cdFx0XHQgICAgLy8gZG8gbm90aGluZ1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdCAgICB0YXJnZXQgPSB1bmlvbih0YXJnZXQsIHdhbGsoaXNDYXB0dXJpbmcsIG1rLCBuZXh0SW5kZXgpKTtcblx0XHRcdH1cblx0XHQgICAgfVxuXHRcdH1cblx0ICAgIH1cblx0ICAgIHJldHVybiB0YXJnZXQ7XG5cdH1cblxuXHR2YXIgcmVzdWx0O1xuXHRpZiAobSBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB7XG5cdCAgICBpZiAoaXNfa2V5T3BlbihpdGVtKSkge1xuXHRcdHJlc3VsdCA9IHdhbGsoaXNDYXB0dXJpbmcsIHJ3aWxkc2VxKG0pLCBuZXh0SW5kZXgpO1xuXHQgICAgfSBlbHNlIGlmIChpc19rZXlDbG9zZShpdGVtKSkge1xuXHRcdHJlc3VsdCA9IHdhbGsoaXNDYXB0dXJpbmcsIG0ubWF0Y2hlciwgbmV4dEluZGV4KTtcblx0ICAgIH0gZWxzZSB7XG5cdFx0cmVzdWx0ID0gd2Fsayhpc0NhcHR1cmluZywgbSwgbmV4dEluZGV4KTtcblx0ICAgIH1cblx0fSBlbHNlIGlmIChtIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0ICAgIHJlc3VsdCA9IGVtcHR5TWF0Y2hlcjtcblx0fSBlbHNlIHtcblx0ICAgIGlmIChpc19rZXlPcGVuKGl0ZW0pKSB7XG5cdFx0cmVzdWx0ID0gd2Fsayhpc0NhcHR1cmluZywgcndpbGRzZXEobS5nZXQoX18pKSwgbmV4dEluZGV4KTtcblx0ICAgIH0gZWxzZSBpZiAoaXNfa2V5Q2xvc2UoaXRlbSkpIHtcblx0XHRyZXN1bHQgPSBlbXB0eU1hdGNoZXI7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHJlc3VsdCA9IHdhbGsoaXNDYXB0dXJpbmcsIG0uZ2V0KF9fKSwgbmV4dEluZGV4KTtcblx0ICAgIH1cblx0ICAgIHJlc3VsdCA9IHVuaW9uKHJlc3VsdCwgd2Fsayhpc0NhcHR1cmluZywgbS5nZXQoaXRlbSksIG5leHRJbmRleCkpO1xuXHR9XG5cdGlmIChpc0NhcHR1cmluZykge1xuXHQgICAgcmVzdWx0ID0gcnNlcShpdGVtLCByZXN1bHQpO1xuXHR9XG5cdHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FwdHVyZU5lc3RlZChtLCBjb250KSB7XG5cdGlmIChtIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIHJldHVybiByd2lsZHNlcShjb250KG0ubWF0Y2hlcikpO1xuXHR9XG5cblx0aWYgKGlzX2VtcHR5TWF0Y2hlcihtKSB8fCAobSBpbnN0YW5jZW9mICRTdWNjZXNzKSkge1xuXHQgICAgcmV0dXJuIGVtcHR5TWF0Y2hlcjtcblx0fVxuXG5cdHZhciB0YXJnZXQgPSBuZXcgJERpY3QoKTtcblx0cnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBfXywgY2FwdHVyZU5lc3RlZChtLmdldChfXyksIGNvbnQpKTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgaWYgKGtleSAhPT0gX18pIHtcblx0XHR2YXIgbWsgPSBtLmdldChrZXkpO1xuXHRcdGlmIChpc19rZXlPcGVuKGtleSkpIHtcblx0XHQgICAgZnVuY3Rpb24gY29udDIobWsyKSB7IHJldHVybiBjYXB0dXJlTmVzdGVkKG1rMiwgY29udCk7IH1cblx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksIGNhcHR1cmVOZXN0ZWQobWssIGNvbnQyKSk7XG5cdFx0fSBlbHNlIGlmIChpc19rZXlDbG9zZShrZXkpKSB7XG5cdFx0ICAgIHJ1cGRhdGVJbnBsYWNlKHRhcmdldCwga2V5LCBjb250KG1rKSk7XG5cdFx0fSBlbHNlIHtcblx0XHQgICAgcnVwZGF0ZUlucGxhY2UodGFyZ2V0LCBrZXksIGNhcHR1cmVOZXN0ZWQobWssIGNvbnQpKTtcblx0XHR9XG5cdCAgICB9XG5cdH1cblx0cmV0dXJuIHRhcmdldC5lbXB0eUd1YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2tpcE5lc3RlZChtLCBjb250KSB7XG5cdGlmIChtIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHtcblx0ICAgIHJldHVybiBjb250KG0ubWF0Y2hlcik7XG5cdH1cblxuXHRpZiAoaXNfZW1wdHlNYXRjaGVyKG0pIHx8IChtIGluc3RhbmNlb2YgJFN1Y2Nlc3MpKSB7XG5cdCAgICByZXR1cm4gZW1wdHlNYXRjaGVyO1xuXHR9XG5cblx0dmFyIHRhcmdldCA9IHNraXBOZXN0ZWQobS5nZXQoX18pLCBjb250KTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgaWYgKGtleSAhPT0gX18pIHtcblx0XHR2YXIgbWsgPSBtLmdldChrZXkpO1xuXHRcdGlmIChpc19rZXlPcGVuKGtleSkpIHtcblx0XHQgICAgZnVuY3Rpb24gY29udDIobWsyKSB7IHJldHVybiBza2lwTmVzdGVkKG1rMiwgY29udCk7IH1cblx0XHQgICAgdGFyZ2V0ID0gdW5pb24odGFyZ2V0LCBza2lwTmVzdGVkKG1rLCBjb250MikpO1xuXHRcdH0gZWxzZSBpZiAoaXNfa2V5Q2xvc2Uoa2V5KSkge1xuXHRcdCAgICB0YXJnZXQgPSB1bmlvbih0YXJnZXQsIGNvbnQobWspKTtcblx0XHR9IGVsc2Uge1xuXHRcdCAgICB0YXJnZXQgPSB1bmlvbih0YXJnZXQsIHNraXBOZXN0ZWQobWssIGNvbnQpKTtcblx0XHR9XG5cdCAgICB9XG5cdH1cblx0cmV0dXJuIHRhcmdldDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXJLZXlzKG0pIHtcbiAgICBpZiAoaXNfZW1wdHlNYXRjaGVyKG0pKSByZXR1cm4gW107XG4gICAgcmV0dXJuIHdhbGtTZXEobSwgZnVuY3Rpb24gKHZzcywgdnNrKSB7IHJldHVybiB2c3M7IH0pO1xuXG4gICAgZnVuY3Rpb24gd2FsayhtLCBrKSB7XG5cdGlmIChtIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHJldHVybiBudWxsO1xuXHRpZiAobSBpbnN0YW5jZW9mICRTdWNjZXNzKSByZXR1cm4gW107XG5cdGlmIChtLmhhcyhfXykpIHJldHVybiBudWxsO1xuXHR2YXIgYWNjID0gW107XG5cdGZvciAodmFyIGtleSBpbiBtLmVudHJpZXMpIHtcblx0ICAgIHZhciBtayA9IG0uZ2V0KGtleSk7XG5cdCAgICB2YXIgcGllY2U7XG5cdCAgICBpZiAoaXNfa2V5T3BlbihrZXkpKSB7XG5cdFx0ZnVuY3Rpb24gc2VxSyh2c3MsIHZzaykge1xuXHRcdCAgICB2YXIgYWNjID0gW107XG5cdFx0ICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdnNzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHR2YXIgdnMgPSB2c3NbaV07XG5cdFx0XHRhY2MgPSBhY2MuY29uY2F0KGsodHJhbnNmb3JtU2Vxcyh2cywga2V5KSwgdnNrKSk7XG5cdFx0ICAgIH1cblx0XHQgICAgcmV0dXJuIGFjYztcblx0XHR9XG5cdFx0cGllY2UgPSB3YWxrU2VxKG1rLCBzZXFLKTtcblx0ICAgIH0gZWxzZSBpZiAoaXNfa2V5Q2xvc2Uoa2V5KSkge1xuXHRcdGRpZShcIm1hdGNoZXJLZXlzOiBpbnRlcm5hbCBlcnJvcjogdW5leHBlY3RlZCBrZXktY2xvc2VcIik7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHBpZWNlID0gayhKU09OLnBhcnNlKGtleSksIG1rKTtcblx0ICAgIH1cblx0ICAgIGlmIChwaWVjZSA9PSBudWxsKSByZXR1cm4gbnVsbDtcblx0ICAgIGFjYyA9IGFjYy5jb25jYXQocGllY2UpO1xuXHR9XG5cdHJldHVybiBhY2M7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2Fsa1NlcShtLCBrKSB7XG5cdGlmIChtIGluc3RhbmNlb2YgJFdpbGRjYXJkU2VxdWVuY2UpIHJldHVybiBudWxsO1xuXHRpZiAobSBpbnN0YW5jZW9mICRTdWNjZXNzKSByZXR1cm4gayhbXSwgZW1wdHlNYXRjaGVyKTsgLy8gVE9ETzogPz9cblx0aWYgKG0uaGFzKF9fKSkgcmV0dXJuIG51bGw7XG5cdHZhciBhY2MgPSBbXTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgdmFyIG1rID0gbS5nZXQoa2V5KTtcblx0ICAgIHZhciBwaWVjZTtcblx0ICAgIGlmIChpc19rZXlDbG9zZShrZXkpKSB7XG5cdFx0cGllY2UgPSBrKFtbXV0sIG1rKTtcblx0ICAgIH0gZWxzZSB7XG5cdFx0ZnVuY3Rpb24gb3V0ZXJLKHYsIHZrKSB7XG5cdFx0ICAgIHJldHVybiB3YWxrU2VxKHZrLCBpbm5lckspO1xuXHRcdCAgICBmdW5jdGlvbiBpbm5lcksodnNzLCB2c2spIHtcblx0XHRcdHZhciBhY2MgPSBbXTtcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgdnNzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHQgICAgdmFyIHZzID0gc2hhbGxvd0NvcHlBcnJheSh2c3NbaV0pO1xuXHRcdFx0ICAgIHZzLnVuc2hpZnQodik7XG5cdFx0XHQgICAgYWNjLnB1c2godnMpO1xuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIGsoYWNjLCB2c2spO1xuXHRcdCAgICB9XG5cdFx0fVxuXHRcdHBpZWNlID0gd2Fsayhyc2VxKGtleSwgbWspLCBvdXRlckspO1xuXHQgICAgfVxuXHQgICAgaWYgKHBpZWNlID09IG51bGwpIHJldHVybiBudWxsO1xuXHQgICAgYWNjID0gYWNjLmNvbmNhdChwaWVjZSk7XG5cdH1cblx0cmV0dXJuIGFjYztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0cmFuc2Zvcm1TZXFzKHZzLCBvcGVuZXIpIHtcblx0aWYgKG9wZW5lciA9PT0gU09BKSByZXR1cm4gdnM7XG5cdGRpZShcIkludGVybmFsIGVycm9yOiB1bmtub3duIG9wZW5lciBcIiArIG9wZW5lcik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBtYXRjaGVyS2V5c1RvT2JqZWN0cyhtYXRjaGVyS2V5c1Jlc3VsdCwgY29tcGlsZWRQcm9qZWN0aW9uKSB7XG4gICAgaWYgKG1hdGNoZXJLZXlzUmVzdWx0ID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYXRjaGVyS2V5c1Jlc3VsdC5sZW5ndGg7IGkrKykge1xuXHR2YXIgZSA9IG1hdGNoZXJLZXlzUmVzdWx0W2ldO1xuXHR2YXIgZCA9IHt9O1xuXHRmb3IgKHZhciBqID0gMDsgaiA8IGUubGVuZ3RoOyBqKyspIHtcblx0ICAgIGRbY29tcGlsZWRQcm9qZWN0aW9uLm5hbWVzW2pdIHx8ICgnJCcgKyBqKV0gPSBlW2pdO1xuXHR9XG5cdHJlc3VsdC5wdXNoKGQpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBwcm9qZWN0T2JqZWN0cyhtLCBjb21waWxlZFByb2plY3Rpb24pIHtcbiAgICByZXR1cm4gbWF0Y2hlcktleXNUb09iamVjdHMobWF0Y2hlcktleXMocHJvamVjdChtLCBjb21waWxlZFByb2plY3Rpb24pKSwgY29tcGlsZWRQcm9qZWN0aW9uKTtcbn1cblxuZnVuY3Rpb24gcHJldHR5TWF0Y2hlcihtLCBpbml0aWFsSW5kZW50KSB7XG4gICAgdmFyIGFjYyA9IFtdO1xuICAgIHdhbGsoaW5pdGlhbEluZGVudCB8fCAwLCBtKTtcbiAgICByZXR1cm4gYWNjLmpvaW4oJycpO1xuXG4gICAgZnVuY3Rpb24gd2FsayhpLCBtKSB7XG5cdGlmIChpc19lbXB0eU1hdGNoZXIobSkpIHtcblx0ICAgIGFjYy5wdXNoKFwiOjo6IG5vIGZ1cnRoZXIgbWF0Y2hlcyBwb3NzaWJsZVwiKTtcblx0ICAgIHJldHVybjtcblx0fVxuXHRpZiAobSBpbnN0YW5jZW9mICRXaWxkY2FyZFNlcXVlbmNlKSB7XG5cdCAgICBhY2MucHVzaChcIi4uLj5cIik7XG5cdCAgICB3YWxrKGkgKyA0LCBtLm1hdGNoZXIpO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cdGlmIChtIGluc3RhbmNlb2YgJFN1Y2Nlc3MpIHtcblx0ICAgIHZhciB2cyA9IEpTT04uc3RyaW5naWZ5KHR5cGVvZiBtLnZhbHVlID09PSAnb2JqZWN0J1xuXHRcdFx0XHQgICAgPyBzZXRUb0FycmF5KG0udmFsdWUpXG5cdFx0XHRcdCAgICA6IG0udmFsdWUpO1xuXHQgICAgYWNjLnB1c2goXCJ7XCIgKyB2cyArIFwifVwiKTtcblx0ICAgIHJldHVybjtcblx0fVxuXG5cdGlmIChtLmxlbmd0aCA9PT0gMCkge1xuXHQgICAgYWNjLnB1c2goXCIgOjo6IGVtcHR5IGhhc2ghXCIpO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cblx0dmFyIG5lZWRTZXAgPSBmYWxzZTtcblx0dmFyIGtleXMgPSBtLnNvcnRlZEtleXMoKTtcblx0Zm9yICh2YXIga2V5aSA9IDA7IGtleWkgPCBrZXlzLmxlbmd0aDsga2V5aSsrKSB7XG5cdCAgICB2YXIga2V5ID0ga2V5c1trZXlpXTtcblx0ICAgIHZhciBrID0gbS5lbnRyaWVzW2tleV07XG5cdCAgICBpZiAobmVlZFNlcCkge1xuXHRcdGFjYy5wdXNoKFwiXFxuXCIpO1xuXHRcdGFjYy5wdXNoKGluZGVudFN0cihpKSk7XG5cdCAgICB9IGVsc2Uge1xuXHRcdG5lZWRTZXAgPSB0cnVlO1xuXHQgICAgfVxuXHQgICAgYWNjLnB1c2goXCIgXCIpO1xuXHQgICAgaWYgKGtleSA9PT0gX18pIGtleSA9ICfimIUnO1xuXHQgICAgaWYgKGtleSA9PT0gU09BKSBrZXkgPSAnPCc7XG5cdCAgICBpZiAoa2V5ID09PSBFT0EpIGtleSA9ICc+Jztcblx0ICAgIGFjYy5wdXNoKGtleSk7XG5cdCAgICB3YWxrKGkgKyBrZXkubGVuZ3RoICsgMSwgayk7XG5cdH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpbmRlbnRTdHIoaSkge1xuXHRyZXR1cm4gbmV3IEFycmF5KGkgKyAxKS5qb2luKCcgJyk7IC8vIGV3d1xuICAgIH1cbn1cblxuZnVuY3Rpb24gc2VyaWFsaXplTWF0Y2hlcihtLCBzZXJpYWxpemVTdWNjZXNzKSB7XG4gICAgcmV0dXJuIHdhbGsobSk7XG4gICAgZnVuY3Rpb24gd2FsayhtKSB7XG5cdGlmIChpc19lbXB0eU1hdGNoZXIobSkpIHJldHVybiBbXTtcblx0aWYgKG0gaW5zdGFuY2VvZiAkV2lsZGNhcmRTZXF1ZW5jZSkge1xuXHQgICAgcmV0dXJuIFtcIi4uLilcIiwgd2FsayhtLm1hdGNoZXIpXTtcblx0fVxuXHRpZiAobSBpbnN0YW5jZW9mICRTdWNjZXNzKSB7XG5cdCAgICByZXR1cm4gW1wiXCIsIHNlcmlhbGl6ZVN1Y2Nlc3MobS52YWx1ZSldO1xuXHR9XG5cdHZhciBhY2MgPSBbXTtcblx0Zm9yICh2YXIga2V5IGluIG0uZW50cmllcykge1xuXHQgICAgdmFyIGsgPSBtLmVudHJpZXNba2V5XTtcblx0ICAgIGlmIChrZXkgPT09IF9fKSBrZXkgPSBbXCJfX1wiXTtcblx0ICAgIGVsc2UgaWYgKGtleSA9PT0gU09BKSBrZXkgPSBbXCIoXCJdO1xuXHQgICAgZWxzZSBpZiAoa2V5ID09PSBFT0EpIGtleSA9IFtcIilcIl07XG5cdCAgICBlbHNlIGtleSA9IEpTT04ucGFyc2Uoa2V5KTtcblx0ICAgIGFjYy5wdXNoKFtrZXksIHdhbGsoayldKTtcblx0fVxuXHRyZXR1cm4gYWNjO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGVzZXJpYWxpemVNYXRjaGVyKHIsIGRlc2VyaWFsaXplU3VjY2Vzcykge1xuICAgIHJldHVybiB3YWxrKHIpO1xuICAgIGZ1bmN0aW9uIHdhbGsocikge1xuXHRpZiAoci5sZW5ndGggPT09IDApIHJldHVybiBlbXB0eU1hdGNoZXI7XG5cdGlmIChyWzBdID09PSBcIi4uLilcIikgcmV0dXJuIHJ3aWxkc2VxKHdhbGsoclsxXSkpO1xuXHRpZiAoclswXSA9PT0gXCJcIikgcmV0dXJuIHJzdWNjZXNzKGRlc2VyaWFsaXplU3VjY2VzcyhyWzFdKSk7XG5cdHZhciBhY2MgPSBuZXcgJERpY3QoKTtcblx0Zm9yICh2YXIgaSA9IDA7IGkgPCByLmxlbmd0aDsgaSsrKSB7XG5cdCAgICB2YXIgcmtleSA9IHJbaV1bMF07XG5cdCAgICB2YXIgcmsgPSByW2ldWzFdO1xuXHQgICAgdmFyIGtleTtcblx0ICAgIGlmIChBcnJheS5pc0FycmF5KHJrZXkpKSB7XG5cdFx0c3dpdGNoIChya2V5WzBdKSB7XG5cdFx0Y2FzZSBcIl9fXCI6IGtleSA9IF9fOyBicmVhaztcblx0XHRjYXNlIFwiKFwiOiBrZXkgPSBTT0E7IGJyZWFrO1xuXHRcdGNhc2UgXCIpXCI6IGtleSA9IEVPQTsgYnJlYWs7XG5cdFx0ZGVmYXVsdDogZGllKFwiSW52YWxpZCBzZXJpYWxpemVkIHNwZWNpYWwga2V5OiBcIiArIHJrZXlbMF0pO1xuXHRcdH1cblx0ICAgIH0gZWxzZSB7XG5cdFx0a2V5ID0gSlNPTi5zdHJpbmdpZnkocmtleSk7XG5cdCAgICB9XG5cdCAgICBydXBkYXRlSW5wbGFjZShhY2MsIGtleSwgd2FsayhyaykpO1xuXHR9XG5cdHJldHVybiBhY2M7XG4gICAgfVxufVxuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vIEdlc3RhbHRzLlxuLy8gVE9ETzogc3VwcG9ydCBJbmZpbml0eSBhcyBhIGxldmVsIG51bWJlclxuXG5mdW5jdGlvbiBHZXN0YWx0TGV2ZWwoc3VicywgYWR2cykge1xuICAgIHRoaXMuc3Vic2NyaXB0aW9ucyA9IHN1YnM7XG4gICAgdGhpcy5hZHZlcnRpc2VtZW50cyA9IGFkdnM7XG59XG5cbkdlc3RhbHRMZXZlbC5wcm90b3R5cGUuaXNFbXB0eSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gaXNfZW1wdHlNYXRjaGVyKHRoaXMuc3Vic2NyaXB0aW9ucykgJiYgaXNfZW1wdHlNYXRjaGVyKHRoaXMuYWR2ZXJ0aXNlbWVudHMpO1xufTtcblxuR2VzdGFsdExldmVsLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiAob3RoZXIpIHtcbiAgICByZXR1cm4gbWF0Y2hlckVxdWFscyh0aGlzLnN1YnNjcmlwdGlvbnMsIG90aGVyLnN1YnNjcmlwdGlvbnMpXG5cdCYmIG1hdGNoZXJFcXVhbHModGhpcy5hZHZlcnRpc2VtZW50cywgb3RoZXIuYWR2ZXJ0aXNlbWVudHMpO1xufTtcblxuR2VzdGFsdExldmVsLnByb3RvdHlwZS5wcmV0dHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGFjYyA9IFtdO1xuICAgIGlmICghaXNfZW1wdHlNYXRjaGVyKHRoaXMuc3Vic2NyaXB0aW9ucykpIHtcblx0YWNjLnB1c2goXCIgIC0gc3ViczpcIik7XG5cdGFjYy5wdXNoKHByZXR0eU1hdGNoZXIodGhpcy5zdWJzY3JpcHRpb25zLCA5KSk7XG5cdGFjYy5wdXNoKFwiXFxuXCIpO1xuICAgIH1cbiAgICBpZiAoIWlzX2VtcHR5TWF0Y2hlcih0aGlzLmFkdmVydGlzZW1lbnRzKSkge1xuXHRhY2MucHVzaChcIiAgLSBhZHZzOlwiKTtcblx0YWNjLnB1c2gocHJldHR5TWF0Y2hlcih0aGlzLmFkdmVydGlzZW1lbnRzLCA5KSk7XG5cdGFjYy5wdXNoKFwiXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gYWNjLmpvaW4oJycpO1xufTtcblxuZnVuY3Rpb24gc3RyYWlnaHRHZXN0YWx0TGV2ZWxPcChvcCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAocDEsIHAyKSB7XG5cdHJldHVybiBuZXcgR2VzdGFsdExldmVsKG9wKHAxLnN1YnNjcmlwdGlvbnMsIHAyLnN1YnNjcmlwdGlvbnMpLFxuXHRcdFx0XHRvcChwMS5hZHZlcnRpc2VtZW50cywgcDIuYWR2ZXJ0aXNlbWVudHMpKTtcbiAgICB9O1xufTtcblxudmFyIGVtcHR5TGV2ZWwgPSBuZXcgR2VzdGFsdExldmVsKGVtcHR5TWF0Y2hlciwgZW1wdHlNYXRjaGVyKTtcbnZhciBlbXB0eU1ldGFMZXZlbCA9IFtdO1xuXG5mdW5jdGlvbiBHZXN0YWx0KG1ldGFMZXZlbHMpIHtcbiAgICB0aGlzLm1ldGFMZXZlbHMgPSBtZXRhTGV2ZWxzO1xufVxuXG5HZXN0YWx0LnByb3RvdHlwZS5nZXRNZXRhTGV2ZWwgPSBmdW5jdGlvbiAobikge1xuICAgIHJldHVybiB0aGlzLm1ldGFMZXZlbHNbbl0gfHwgZW1wdHlNZXRhTGV2ZWw7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS5nZXRMZXZlbCA9IGZ1bmN0aW9uIChtZXRhTGV2ZWwsIGxldmVsKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TWV0YUxldmVsKG1ldGFMZXZlbClbbGV2ZWxdIHx8IGVtcHR5TGV2ZWw7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS5tZXRhTGV2ZWxDb3VudCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXMubWV0YUxldmVscy5sZW5ndGg7IH07XG5HZXN0YWx0LnByb3RvdHlwZS5sZXZlbENvdW50ID0gZnVuY3Rpb24gKG4pIHsgcmV0dXJuIHRoaXMuZ2V0TWV0YUxldmVsKG4pLmxlbmd0aDsgfTtcblxuR2VzdGFsdC5wcm90b3R5cGUubWF0Y2hWYWx1ZSA9IGZ1bmN0aW9uIChib2R5LCBtZXRhTGV2ZWwsIGlzRmVlZGJhY2spIHtcbiAgICB2YXIgbGV2ZWxzID0gdGhpcy5nZXRNZXRhTGV2ZWwobWV0YUxldmVsKTtcbiAgICB2YXIgcGlkcyA9IHt9O1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGV2ZWxzLmxlbmd0aDsgaSsrKSB7XG5cdHZhciBtYXRjaGVyID0gKGlzRmVlZGJhY2sgPyBsZXZlbHNbaV0uYWR2ZXJ0aXNlbWVudHMgOiBsZXZlbHNbaV0uc3Vic2NyaXB0aW9ucyk7XG5cdHNldFVuaW9uSW5wbGFjZShwaWRzLCBtYXRjaFZhbHVlKG1hdGNoZXIsIGJvZHkpKTtcbiAgICB9XG4gICAgcmV0dXJuIHNldFRvQXJyYXkocGlkcyk7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS5wcm9qZWN0ID0gZnVuY3Rpb24gKHNwZWMsIGdldEFkdmVydGlzZW1lbnRzLCBtZXRhTGV2ZWwsIGxldmVsKSB7XG4gICAgdmFyIGwgPSB0aGlzLmdldExldmVsKG1ldGFMZXZlbCB8IDAsIGxldmVsIHwgMCk7XG4gICAgdmFyIG1hdGNoZXIgPSAoZ2V0QWR2ZXJ0aXNlbWVudHMgPyBsLmFkdmVydGlzZW1lbnRzIDogbC5zdWJzY3JpcHRpb25zKTtcbiAgICByZXR1cm4gcHJvamVjdChtYXRjaGVyLCBzcGVjKTtcbn07XG5cbkdlc3RhbHQucHJvdG90eXBlLmRyb3AgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIG1scyA9IHNoYWxsb3dDb3B5QXJyYXkodGhpcy5tZXRhTGV2ZWxzKTtcbiAgICBtbHMuc2hpZnQoKTtcbiAgICByZXR1cm4gbmV3IEdlc3RhbHQobWxzKTtcbn07XG5cbkdlc3RhbHQucHJvdG90eXBlLmxpZnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIG1scyA9IHNoYWxsb3dDb3B5QXJyYXkodGhpcy5tZXRhTGV2ZWxzKTtcbiAgICBtbHMudW5zaGlmdChlbXB0eU1ldGFMZXZlbCk7XG4gICAgcmV0dXJuIG5ldyBHZXN0YWx0KG1scyk7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiAob3RoZXIpIHtcbiAgICBpZiAodGhpcy5tZXRhTGV2ZWxzLmxlbmd0aCAhPT0gb3RoZXIubWV0YUxldmVscy5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMubWV0YUxldmVscy5sZW5ndGg7IGkrKykge1xuXHR2YXIgbHMxID0gdGhpcy5tZXRhTGV2ZWxzW2ldO1xuXHR2YXIgbHMyID0gb3RoZXIubWV0YUxldmVsc1tpXTtcblx0aWYgKGxzMS5sZW5ndGggIT09IGxzMi5sZW5ndGgpIHJldHVybiBmYWxzZTtcblx0Zm9yICh2YXIgaiA9IDA7IGogPCBsczEubGVuZ3RoOyBqKyspIHtcblx0ICAgIHZhciBwMSA9IGxzMVtqXTtcblx0ICAgIHZhciBwMiA9IGxzMltqXTtcblx0ICAgIGlmICghcDEuZXF1YWxzKHAyKSkgcmV0dXJuIGZhbHNlO1xuXHR9XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufTtcblxuZnVuY3Rpb24gc2ltcGxlR2VzdGFsdChpc0FkdiwgcGF0LCBtZXRhTGV2ZWwsIGxldmVsKSB7XG4gICAgbWV0YUxldmVsID0gbWV0YUxldmVsIHx8IDA7XG4gICAgbGV2ZWwgPSBsZXZlbCB8fCAwO1xuICAgIHZhciBtYXRjaGVyID0gY29tcGlsZVBhdHRlcm4odHJ1ZSwgcGF0KTtcbiAgICB2YXIgbCA9IG5ldyBHZXN0YWx0TGV2ZWwoaXNBZHYgPyBlbXB0eU1hdGNoZXIgOiBtYXRjaGVyLFxuXHRcdFx0ICAgICBpc0FkdiA/IG1hdGNoZXIgOiBlbXB0eU1hdGNoZXIpO1xuICAgIHZhciBsZXZlbHMgPSBbbF07XG4gICAgd2hpbGUgKGxldmVsLS0pIHsgbGV2ZWxzLnVuc2hpZnQoZW1wdHlMZXZlbCk7IH1cbiAgICB2YXIgbWV0YUxldmVscyA9IFtsZXZlbHNdO1xuICAgIHdoaWxlIChtZXRhTGV2ZWwtLSkgeyBtZXRhTGV2ZWxzLnVuc2hpZnQoZW1wdHlNZXRhTGV2ZWwpOyB9XG4gICAgcmV0dXJuIG5ldyBHZXN0YWx0KG1ldGFMZXZlbHMpO1xufVxuXG52YXIgZW1wdHlHZXN0YWx0ID0gbmV3IEdlc3RhbHQoW10pO1xuXG4vLyBOb3QgcXVpdGUgd2hhdCBpdCBzYXlzIG9uIHRoZSB0aW4gLSB0aGUgdHJ1ZSBmdWxsR2VzdGFsdFxuLy8gd291bGRuJ3QgYmUgcGFyYW1ldGVyaXplZCBvbiB0aGUgbnVtYmVyIG9mIGxldmVscyBhbmRcbi8vIG1ldGFsZXZlbHMsIGJ1dCBpbnN0ZWFkIHdvdWxkIGJlIGZ1bGwgYXQgKmFsbCogbGV2ZWxzIGFuZFxuLy8gbWV0YWxldmVscy4gT3VyIHJlcHJlc2VudGF0aW9uIGxlYWtzIHRocm91Z2ggaW50byB0aGUgaW50ZXJmYWNlXG4vLyBoZXJlIDotL1xuZnVuY3Rpb24gZnVsbEdlc3RhbHQobk1ldGFsZXZlbHMsIG5MZXZlbHMpIHtcbiAgICB2YXIgbWF0Y2hlciA9IGNvbXBpbGVQYXR0ZXJuKHRydWUsIF9fKTtcbiAgICB2YXIgbCA9IG5ldyBHZXN0YWx0TGV2ZWwobWF0Y2hlciwgbWF0Y2hlcik7XG4gICAgdmFyIGxldmVscyA9IFtdO1xuICAgIHdoaWxlIChuTGV2ZWxzLS0pIHsgbGV2ZWxzLnB1c2gobCk7IH1cbiAgICB2YXIgbWV0YUxldmVscyA9IFtdO1xuICAgIHdoaWxlIChuTWV0YWxldmVscy0tKSB7IG1ldGFMZXZlbHMucHVzaChsZXZlbHMpOyB9XG4gICAgcmV0dXJuIG5ldyBHZXN0YWx0KG1ldGFMZXZlbHMpO1xufVxuXG5HZXN0YWx0LnByb3RvdHlwZS5pc0VtcHR5ID0gZnVuY3Rpb24gKCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5tZXRhTGV2ZWxzLmxlbmd0aDsgaSsrKSB7XG5cdHZhciBsZXZlbHMgPSB0aGlzLm1ldGFMZXZlbHNbaV07XG5cdGZvciAodmFyIGogPSAwOyBqIDwgbGV2ZWxzLmxlbmd0aDsgaisrKSB7XG5cdCAgICBpZiAoIWxldmVsc1tqXS5pc0VtcHR5KCkpIHJldHVybiBmYWxzZTtcblx0fVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn07XG5cbmZ1bmN0aW9uIG1heWJlUHVzaExldmVsKGxldmVscywgaSwgbGV2ZWwpIHtcbiAgICBpZiAoIWxldmVsLmlzRW1wdHkoKSkge1xuXHR3aGlsZSAobGV2ZWxzLmxlbmd0aCA8IGkpIGxldmVscy5wdXNoKGVtcHR5TGV2ZWwpO1xuXHRsZXZlbHMucHVzaChsZXZlbCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBtYXliZVB1c2hNZXRhTGV2ZWwobWV0YUxldmVscywgaSwgbWV0YUxldmVsKSB7XG4gICAgaWYgKG1ldGFMZXZlbC5sZW5ndGggPiAwKSB7XG5cdHdoaWxlIChtZXRhTGV2ZWxzLmxlbmd0aCA8IGkpIG1ldGFMZXZlbHMucHVzaChlbXB0eU1ldGFMZXZlbCk7XG5cdG1ldGFMZXZlbHMucHVzaChtZXRhTGV2ZWwpO1xuICAgIH1cbn1cblxuR2VzdGFsdC5wcm90b3R5cGUubWFwWmlwID0gZnVuY3Rpb24gKG90aGVyLCBsZW5ndGhDb21iaW5lciwgZikge1xuICAgIHZhciBtZXRhTGV2ZWxzID0gW107XG4gICAgdmFyIG1sczEgPSB0aGlzLm1ldGFMZXZlbHM7XG4gICAgdmFyIG1sczIgPSBvdGhlci5tZXRhTGV2ZWxzO1xuICAgIHZhciBubSA9IGxlbmd0aENvbWJpbmVyKG1sczEubGVuZ3RoLCBtbHMyLmxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBubTsgaSsrKSB7XG5cdHZhciBsZXZlbHMgPSBbXTtcblx0dmFyIGxzMSA9IG1sczFbaV0gfHwgZW1wdHlNZXRhTGV2ZWw7XG5cdHZhciBsczIgPSBtbHMyW2ldIHx8IGVtcHR5TWV0YUxldmVsO1xuXHR2YXIgbmwgPSBsZW5ndGhDb21iaW5lcihsczEubGVuZ3RoLCBsczIubGVuZ3RoKTtcblx0Zm9yICh2YXIgaiA9IDA7IGogPCBubDsgaisrKSB7XG5cdCAgICB2YXIgcDEgPSBsczFbal0gfHwgZW1wdHlMZXZlbDtcblx0ICAgIHZhciBwMiA9IGxzMltqXSB8fCBlbXB0eUxldmVsO1xuXHQgICAgdmFyIHAgPSBmKHAxLCBwMik7XG5cdCAgICBtYXliZVB1c2hMZXZlbChsZXZlbHMsIGosIHApO1xuXHR9XG5cdG1heWJlUHVzaE1ldGFMZXZlbChtZXRhTGV2ZWxzLCBpLCBsZXZlbHMpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IEdlc3RhbHQobWV0YUxldmVscyk7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS51bmlvbjEgPSBmdW5jdGlvbiAob3RoZXIpIHtcbiAgICByZXR1cm4gdGhpcy5tYXBaaXAob3RoZXIsIE1hdGgubWF4LCBzdHJhaWdodEdlc3RhbHRMZXZlbE9wKHVuaW9uKSk7XG59O1xuXG5mdW5jdGlvbiBnZXN0YWx0VW5pb24oZ3MpIHtcbiAgICBpZiAoZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gZW1wdHlHZXN0YWx0O1xuICAgIHZhciBhY2MgPSBnc1swXTtcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8IGdzLmxlbmd0aDsgaSsrKSB7XG5cdGFjYyA9IGFjYy51bmlvbjEoZ3NbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gYWNjO1xufVxuXG5HZXN0YWx0LnByb3RvdHlwZS51bmlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDAgPyB0aGlzLnVuaW9uMShnZXN0YWx0VW5pb24oYXJndW1lbnRzKSkgOiB0aGlzO1xufTtcblxuLy8gQWNjdW11bGF0ZXMgbWF0Y2hlcnMgZnJvbSBoaWdoZXItbnVtYmVyZWQgbGV2ZWxzIGludG9cbi8vIGxvd2VyLW51bWJlcmVkIGxldmVscy5cbmZ1bmN0aW9uIHRlbGVzY29wZUxldmVscyhsZXZlbHMpIHtcbiAgICB2YXIgcmVzdWx0ID0gc2hhbGxvd0NvcHlBcnJheShsZXZlbHMpO1xuICAgIGZvciAodmFyIGkgPSByZXN1bHQubGVuZ3RoIC0gMjsgaSA+PSAwOyBpLS0pIHtcblx0cmVzdWx0W2ldID1cblx0ICAgIG5ldyBHZXN0YWx0TGV2ZWwodW5pb24ocmVzdWx0W2ldLnN1YnNjcmlwdGlvbnMsIHJlc3VsdFtpKzFdLnN1YnNjcmlwdGlvbnMpLFxuXHRcdFx0ICAgICB1bmlvbihyZXN1bHRbaV0uYWR2ZXJ0aXNlbWVudHMsIHJlc3VsdFtpKzFdLmFkdmVydGlzZW1lbnRzKSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS50ZWxlc2NvcGVkID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBtbHMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMubWV0YUxldmVscy5sZW5ndGg7IGkrKykge1xuXHRtbHMucHVzaCh0ZWxlc2NvcGVMZXZlbHModGhpcy5tZXRhTGV2ZWxzW2ldKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgR2VzdGFsdChtbHMpO1xufTtcblxuR2VzdGFsdC5wcm90b3R5cGUuZmlsdGVyID0gZnVuY3Rpb24gKHBlcnNwZWN0aXZlKSB7XG4gICAgdmFyIG1ldGFMZXZlbHMgPSBbXTtcbiAgICB2YXIgbWxzMSA9IHRoaXMubWV0YUxldmVscztcbiAgICB2YXIgbWxzMiA9IHBlcnNwZWN0aXZlLm1ldGFMZXZlbHM7XG4gICAgdmFyIG5tID0gTWF0aC5taW4obWxzMS5sZW5ndGgsIG1sczIubGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5tOyBpKyspIHtcblx0dmFyIGxldmVscyA9IFtdO1xuXHR2YXIgbHMxID0gbWxzMVtpXSB8fCBlbXB0eU1ldGFMZXZlbDtcblx0dmFyIGxzMiA9IG1sczJbaV0gfHwgZW1wdHlNZXRhTGV2ZWw7XG5cdHZhciBubCA9IE1hdGgubWluKGxzMS5sZW5ndGgsIGxzMi5sZW5ndGggLSAxKTtcblx0Zm9yICh2YXIgaiA9IDA7IGogPCBubDsgaisrKSB7XG5cdCAgICB2YXIgcDEgPSBsczFbal0gfHwgZW1wdHlMZXZlbDtcblx0ICAgIHZhciBzdWJzID0gZW1wdHlNYXRjaGVyO1xuXHQgICAgdmFyIGFkdnMgPSBlbXB0eU1hdGNoZXI7XG5cdCAgICBmb3IgKHZhciBrID0gaiArIDE7IGsgPCBsczIubGVuZ3RoOyBrKyspIHtcblx0XHR2YXIgcDIgPSBsczJba10gfHwgZW1wdHlMZXZlbDtcblx0XHRzdWJzID0gdW5pb24oc3VicywgaW50ZXJzZWN0KHAxLnN1YnNjcmlwdGlvbnMsIHAyLmFkdmVydGlzZW1lbnRzKSk7XG5cdFx0YWR2cyA9IHVuaW9uKGFkdnMsIGludGVyc2VjdChwMS5hZHZlcnRpc2VtZW50cywgcDIuc3Vic2NyaXB0aW9ucykpO1xuXHQgICAgfVxuXHQgICAgbWF5YmVQdXNoTGV2ZWwobGV2ZWxzLCBqLCBuZXcgR2VzdGFsdExldmVsKHN1YnMsIGFkdnMpKTtcblx0fVxuXHRtYXliZVB1c2hNZXRhTGV2ZWwobWV0YUxldmVscywgaSwgbGV2ZWxzKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBHZXN0YWx0KG1ldGFMZXZlbHMpO1xufTtcblxuR2VzdGFsdC5wcm90b3R5cGUubWF0Y2ggPSBmdW5jdGlvbiAocGVyc3BlY3RpdmUpIHtcbiAgICB2YXIgcGlkcyA9IHt9O1xuICAgIHZhciBubSA9IE1hdGgubWluKHRoaXMubWV0YUxldmVscy5sZW5ndGgsIHBlcnNwZWN0aXZlLm1ldGFMZXZlbHMubGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5tOyBpKyspIHtcblx0dmFyIGxzMSA9IHRoaXMubWV0YUxldmVsc1tpXSB8fCBlbXB0eU1ldGFMZXZlbDtcblx0dmFyIGxzMiA9IHBlcnNwZWN0aXZlLm1ldGFMZXZlbHNbaV0gfHwgZW1wdHlNZXRhTGV2ZWw7XG5cdHZhciBubCA9IE1hdGgubWluKGxzMS5sZW5ndGgsIGxzMi5sZW5ndGggLSAxKTtcblx0Zm9yICh2YXIgaiA9IDA7IGogPCBubDsgaisrKSB7XG5cdCAgICB2YXIgcDEgPSBsczFbal0gfHwgZW1wdHlMZXZlbDtcblx0ICAgIGZvciAodmFyIGsgPSBqICsgMTsgayA8IGxzMi5sZW5ndGg7IGsrKykge1xuXHRcdHZhciBwMiA9IGxzMltrXSB8fCBlbXB0eUxldmVsO1xuXHRcdG1hdGNoTWF0Y2hlcihwMS5zdWJzY3JpcHRpb25zLCBwMi5hZHZlcnRpc2VtZW50cywgcGlkcyk7XG5cdFx0bWF0Y2hNYXRjaGVyKHAxLmFkdmVydGlzZW1lbnRzLCBwMi5zdWJzY3JpcHRpb25zLCBwaWRzKTtcblx0ICAgIH1cblx0fVxuICAgIH1cbiAgICByZXR1cm4gc2V0VG9BcnJheShwaWRzKTtcbn07XG5cbkdlc3RhbHQucHJvdG90eXBlLmVyYXNlUGF0aCA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMubWFwWmlwKHBhdGgsIE1hdGgubWF4LCBzdHJhaWdodEdlc3RhbHRMZXZlbE9wKGVyYXNlUGF0aCkpO1xufTtcblxuZnVuY3Rpb24gbWFwTGV2ZWxzKGlucHV0TWV0YUxldmVscywgZiwgZW1wdHlDaGVjaywgaW5wdXRFbXB0eUxldmVsLCBvdXRwdXRFbXB0eUxldmVsKSB7XG4gICAgdmFyIG91dHB1dE1ldGFMZXZlbHMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlucHV0TWV0YUxldmVscy5sZW5ndGg7IGkrKykge1xuXHR2YXIgbHMgPSBpbnB1dE1ldGFMZXZlbHNbaV07XG5cdHZhciBsZXZlbHMgPSBbXTtcblx0Zm9yICh2YXIgaiA9IDA7IGogPCBscy5sZW5ndGg7IGorKykge1xuXHQgICAgdmFyIHAgPSBmKGxzW2pdIHx8IGlucHV0RW1wdHlMZXZlbCwgaSwgaik7XG5cdCAgICBpZiAoIWVtcHR5Q2hlY2socCwgaSwgaikpIHtcblx0XHR3aGlsZSAobGV2ZWxzLmxlbmd0aCA8IGopIGxldmVscy5wdXNoKG91dHB1dEVtcHR5TGV2ZWwpO1xuXHRcdGxldmVscy5wdXNoKHApO1xuXHQgICAgfVxuXHR9XG5cdGlmIChsZXZlbHMubGVuZ3RoID4gMCkge1xuXHQgICAgd2hpbGUgKG91dHB1dE1ldGFMZXZlbHMubGVuZ3RoIDwgaSkgb3V0cHV0TWV0YUxldmVscy5wdXNoKGVtcHR5TWV0YUxldmVsKTtcblx0ICAgIG91dHB1dE1ldGFMZXZlbHMucHVzaChsZXZlbHMpO1xuXHR9XG4gICAgfVxuICAgIHJldHVybiBvdXRwdXRNZXRhTGV2ZWxzO1xufTtcblxuR2VzdGFsdC5wcm90b3R5cGUudHJhbnNmb3JtID0gZnVuY3Rpb24gKGYpIHtcbiAgICByZXR1cm4gbmV3IEdlc3RhbHQobWFwTGV2ZWxzKHRoaXMubWV0YUxldmVscywgZnVuY3Rpb24gKHAsIG1sLCBsKSB7XG5cdHJldHVybiBuZXcgR2VzdGFsdExldmVsKGYocC5zdWJzY3JpcHRpb25zLCBtbCwgbCwgZmFsc2UpLFxuXHRcdFx0XHRmKHAuYWR2ZXJ0aXNlbWVudHMsIG1sLCBsLCB0cnVlKSk7XG4gICAgfSwgZnVuY3Rpb24gKHApIHtcblx0cmV0dXJuIHAuaXNFbXB0eSgpO1xuICAgIH0sIGVtcHR5TGV2ZWwsIGVtcHR5TGV2ZWwpKTtcbn07XG5cbkdlc3RhbHQucHJvdG90eXBlLnN0cmlwTGFiZWwgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtKGZ1bmN0aW9uIChtKSB7IHJldHVybiByZWxhYmVsKG0sIGZ1bmN0aW9uICh2KSB7IHJldHVybiB0cnVlOyB9KTsgfSk7XG59O1xuXG5HZXN0YWx0LnByb3RvdHlwZS5sYWJlbCA9IGZ1bmN0aW9uIChwaWQpIHtcbiAgICB2YXIgcGlkcyA9IGFycmF5VG9TZXQoW3BpZF0pO1xuICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybShmdW5jdGlvbiAobSkgeyByZXR1cm4gcmVsYWJlbChtLCBmdW5jdGlvbiAodikgeyByZXR1cm4gcGlkczsgfSk7IH0pO1xufTtcblxuR2VzdGFsdC5wcm90b3R5cGUucHJldHR5ID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhY2MgPSBbXTtcbiAgICBpZiAodGhpcy5pc0VtcHR5KCkpIHtcblx0YWNjLnB1c2goXCJFTVBUWSBHRVNUQUxUXFxuXCIpO1xuICAgIH0gZWxzZSB7XG5cdGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5tZXRhTGV2ZWxzLmxlbmd0aDsgaSsrKSB7XG5cdCAgICB2YXIgbHMgPSB0aGlzLm1ldGFMZXZlbHNbaV07XG5cdCAgICBmb3IgKHZhciBqID0gMDsgaiA8IGxzLmxlbmd0aDsgaisrKSB7XG5cdFx0dmFyIHAgPSBsc1tqXTtcblx0XHRpZiAoIXAuaXNFbXB0eSgpKSB7XG5cdFx0ICAgIGFjYy5wdXNoKFwiR0VTVEFMVCBtZXRhbGV2ZWwgXCIgKyBpICsgXCIgbGV2ZWwgXCIgKyBqICsgXCI6XFxuXCIpO1xuXHRcdCAgICBhY2MucHVzaChwLnByZXR0eSgpKTtcblx0XHR9XG5cdCAgICB9XG5cdH1cbiAgICB9XG4gICAgcmV0dXJuIGFjYy5qb2luKCcnKTtcbn07XG5cbkdlc3RhbHQucHJvdG90eXBlLnNlcmlhbGl6ZSA9IGZ1bmN0aW9uIChzZXJpYWxpemVTdWNjZXNzKSB7XG4gICAgaWYgKHR5cGVvZiBzZXJpYWxpemVTdWNjZXNzID09PSAndW5kZWZpbmVkJykge1xuXHRzZXJpYWxpemVTdWNjZXNzID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIHYgPT09IHRydWUgPyB0cnVlIDogc2V0VG9BcnJheSh2KTsgfTtcbiAgICB9XG4gICAgcmV0dXJuIFtcImdlc3RhbHRcIiwgbWFwTGV2ZWxzKHRoaXMubWV0YUxldmVscywgZnVuY3Rpb24gKHApIHtcblx0cmV0dXJuIFtzZXJpYWxpemVNYXRjaGVyKHAuc3Vic2NyaXB0aW9ucywgc2VyaWFsaXplU3VjY2VzcyksXG5cdFx0c2VyaWFsaXplTWF0Y2hlcihwLmFkdmVydGlzZW1lbnRzLCBzZXJpYWxpemVTdWNjZXNzKV07XG4gICAgfSwgZnVuY3Rpb24gKHByKSB7XG5cdHJldHVybiBwci5sZW5ndGggPT09IDIgJiYgcHJbMF0ubGVuZ3RoID09PSAwICYmIHByWzFdLmxlbmd0aCA9PT0gMDtcbiAgICB9LCBlbXB0eUxldmVsLCBbW10sW11dKV07XG59O1xuXG5mdW5jdGlvbiBkZXNlcmlhbGl6ZUdlc3RhbHQociwgZGVzZXJpYWxpemVTdWNjZXNzKSB7XG4gICAgaWYgKHR5cGVvZiBkZXNlcmlhbGl6ZVN1Y2Nlc3MgPT09ICd1bmRlZmluZWQnKSB7XG5cdGRlc2VyaWFsaXplU3VjY2VzcyA9IGZ1bmN0aW9uICh2KSB7IHJldHVybiB2ID09PSB0cnVlID8gdHJ1ZSA6IGFycmF5VG9TZXQodik7IH07XG4gICAgfVxuICAgIGlmIChyWzBdICE9PSBcImdlc3RhbHRcIikgZGllKFwiSW52YWxpZCBnZXN0YWx0IHNlcmlhbGl6YXRpb246IFwiICsgcik7XG4gICAgcmV0dXJuIG5ldyBHZXN0YWx0KG1hcExldmVscyhyWzFdLCBmdW5jdGlvbiAocHIpIHtcblx0cmV0dXJuIG5ldyBHZXN0YWx0TGV2ZWwoZGVzZXJpYWxpemVNYXRjaGVyKHByWzBdLCBkZXNlcmlhbGl6ZVN1Y2Nlc3MpLFxuXHRcdFx0XHRkZXNlcmlhbGl6ZU1hdGNoZXIocHJbMV0sIGRlc2VyaWFsaXplU3VjY2VzcykpO1xuICAgIH0sIGZ1bmN0aW9uIChwKSB7XG5cdHJldHVybiBwLmlzRW1wdHkoKTtcbiAgICB9LCBbW10sW11dLCBlbXB0eUxldmVsKSk7XG59XG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5tb2R1bGUuZXhwb3J0cy5fXyA9IF9fO1xubW9kdWxlLmV4cG9ydHMuYXJyYXlUb1NldCA9IGFycmF5VG9TZXQ7XG5tb2R1bGUuZXhwb3J0cy5zZXRUb0FycmF5ID0gc2V0VG9BcnJheTtcbm1vZHVsZS5leHBvcnRzLnNldFVuaW9uID0gc2V0VW5pb247XG5tb2R1bGUuZXhwb3J0cy5zZXRTdWJ0cmFjdCA9IHNldFN1YnRyYWN0O1xubW9kdWxlLmV4cG9ydHMuc2V0SW50ZXJzZWN0ID0gc2V0SW50ZXJzZWN0O1xubW9kdWxlLmV4cG9ydHMuc2V0RXF1YWwgPSBzZXRFcXVhbDtcbm1vZHVsZS5leHBvcnRzLmlzX2VtcHR5U2V0ID0gaXNfZW1wdHlTZXQ7XG5tb2R1bGUuZXhwb3J0cy4kQ2FwdHVyZSA9ICRDYXB0dXJlO1xubW9kdWxlLmV4cG9ydHMuXyQgPSBfJDtcbm1vZHVsZS5leHBvcnRzLmlzX2VtcHR5TWF0Y2hlciA9IGlzX2VtcHR5TWF0Y2hlcjtcbm1vZHVsZS5leHBvcnRzLmVtcHR5TWF0Y2hlciA9IGVtcHR5TWF0Y2hlcjtcbm1vZHVsZS5leHBvcnRzLmVtYmVkZGVkTWF0Y2hlciA9IGVtYmVkZGVkTWF0Y2hlcjtcbm1vZHVsZS5leHBvcnRzLmNvbXBpbGVQYXR0ZXJuID0gY29tcGlsZVBhdHRlcm47XG5tb2R1bGUuZXhwb3J0cy5tYXRjaFBhdHRlcm4gPSBtYXRjaFBhdHRlcm47XG5tb2R1bGUuZXhwb3J0cy51bmlvbiA9IHVuaW9uTjtcbm1vZHVsZS5leHBvcnRzLmludGVyc2VjdCA9IGludGVyc2VjdDtcbm1vZHVsZS5leHBvcnRzLmVyYXNlUGF0aCA9IGVyYXNlUGF0aDtcbm1vZHVsZS5leHBvcnRzLm1hdGNoVmFsdWUgPSBtYXRjaFZhbHVlO1xubW9kdWxlLmV4cG9ydHMubWF0Y2hNYXRjaGVyID0gbWF0Y2hNYXRjaGVyO1xubW9kdWxlLmV4cG9ydHMuYXBwZW5kTWF0Y2hlciA9IGFwcGVuZE1hdGNoZXI7XG5tb2R1bGUuZXhwb3J0cy5yZWxhYmVsID0gcmVsYWJlbDtcbm1vZHVsZS5leHBvcnRzLmNvbXBpbGVQcm9qZWN0aW9uID0gY29tcGlsZVByb2plY3Rpb247XG5tb2R1bGUuZXhwb3J0cy5wcm9qZWN0aW9uVG9QYXR0ZXJuID0gcHJvamVjdGlvblRvUGF0dGVybjtcbm1vZHVsZS5leHBvcnRzLnByb2plY3QgPSBwcm9qZWN0O1xubW9kdWxlLmV4cG9ydHMubWF0Y2hlcktleXMgPSBtYXRjaGVyS2V5cztcbm1vZHVsZS5leHBvcnRzLm1hdGNoZXJLZXlzVG9PYmplY3RzID0gbWF0Y2hlcktleXNUb09iamVjdHM7XG5tb2R1bGUuZXhwb3J0cy5wcm9qZWN0T2JqZWN0cyA9IHByb2plY3RPYmplY3RzO1xubW9kdWxlLmV4cG9ydHMubWF0Y2hlckVxdWFscyA9IG1hdGNoZXJFcXVhbHM7XG5tb2R1bGUuZXhwb3J0cy5wcmV0dHlNYXRjaGVyID0gcHJldHR5TWF0Y2hlcjtcbm1vZHVsZS5leHBvcnRzLnNlcmlhbGl6ZU1hdGNoZXIgPSBzZXJpYWxpemVNYXRjaGVyO1xubW9kdWxlLmV4cG9ydHMuZGVzZXJpYWxpemVNYXRjaGVyID0gZGVzZXJpYWxpemVNYXRjaGVyO1xuXG5tb2R1bGUuZXhwb3J0cy5HZXN0YWx0TGV2ZWwgPSBHZXN0YWx0TGV2ZWw7XG5tb2R1bGUuZXhwb3J0cy5HZXN0YWx0ID0gR2VzdGFsdDtcbm1vZHVsZS5leHBvcnRzLnNpbXBsZUdlc3RhbHQgPSBzaW1wbGVHZXN0YWx0O1xubW9kdWxlLmV4cG9ydHMuZW1wdHlHZXN0YWx0ID0gZW1wdHlHZXN0YWx0O1xubW9kdWxlLmV4cG9ydHMuZnVsbEdlc3RhbHQgPSBmdWxsR2VzdGFsdDtcbm1vZHVsZS5leHBvcnRzLmdlc3RhbHRVbmlvbiA9IGdlc3RhbHRVbmlvbjtcbm1vZHVsZS5leHBvcnRzLmRlc2VyaWFsaXplR2VzdGFsdCA9IGRlc2VyaWFsaXplR2VzdGFsdDtcbiIsInZhciBNaW5pbWFydCA9IHJlcXVpcmUoXCIuL21pbmltYXJ0LmpzXCIpO1xudmFyIFJvdXRlID0gTWluaW1hcnQuUm91dGU7XG52YXIgV29ybGQgPSBNaW5pbWFydC5Xb3JsZDtcbnZhciBzdWIgPSBNaW5pbWFydC5zdWI7XG52YXIgcHViID0gTWluaW1hcnQucHViO1xudmFyIF9fID0gTWluaW1hcnQuX187XG5cbmZ1bmN0aW9uIHNwYXduUm91dGluZ1RhYmxlV2lkZ2V0KHNlbGVjdG9yLCBmcmFnbWVudENsYXNzLCBkb21XcmFwLCBvYnNlcnZhdGlvbkxldmVsKSB7XG4gICAgb2JzZXJ2YXRpb25MZXZlbCA9IG9ic2VydmF0aW9uTGV2ZWwgfHwgMTA7XG4gICAgLy8gXiBhcmJpdHJhcnk6IHNob3VsZCBiZSBJbmZpbml0eSwgd2hlbiByb3V0ZS5qcyBzdXBwb3J0cyBpdC4gVE9ET1xuICAgIGRvbVdyYXAgPSBkb21XcmFwIHx8IE1pbmltYXJ0LkRPTS5kZWZhdWx0V3JhcEZ1bmN0aW9uO1xuXG4gICAgV29ybGQuc3Bhd24oe1xuXHRib290OiBmdW5jdGlvbiAoKSB7IHRoaXMudXBkYXRlU3RhdGUoKTsgfSxcblxuXHRzdGF0ZTogUm91dGUuZW1wdHlHZXN0YWx0LnNlcmlhbGl6ZSgpLFxuXHRuZXh0U3RhdGU6IFJvdXRlLmVtcHR5R2VzdGFsdC5zZXJpYWxpemUoKSxcblx0dGltZXI6IGZhbHNlLFxuXG5cdGxvY2FsR2VzdGFsdDogKHN1YiggICAgICAgZG9tV3JhcChzZWxlY3RvciwgZnJhZ21lbnRDbGFzcywgX18pLCAwLCAyKVxuXHRcdCAgICAgICAudW5pb24ocHViKGRvbVdyYXAoc2VsZWN0b3IsIGZyYWdtZW50Q2xhc3MsIF9fKSwgMCwgMikpXG5cdFx0ICAgICAgIC50ZWxlc2NvcGVkKCkpLFxuXG5cdGRpZ2VzdEdlc3RhbHQ6IGZ1bmN0aW9uIChnKSB7XG5cdCAgICByZXR1cm4gZy5zdHJpcExhYmVsKCkuZXJhc2VQYXRoKHRoaXMubG9jYWxHZXN0YWx0KS5zZXJpYWxpemUoKTtcblx0fSxcblxuXHR1cGRhdGVTdGF0ZTogZnVuY3Rpb24gKCkge1xuXHQgICAgdmFyIGVsdHMgPSBbXCJwcmVcIiwgUm91dGUuZGVzZXJpYWxpemVHZXN0YWx0KHRoaXMuc3RhdGUpLnByZXR0eSgpXTtcblx0ICAgIFdvcmxkLnVwZGF0ZVJvdXRlcyhbc3ViKF9fLCAwLCBvYnNlcnZhdGlvbkxldmVsKSxcblx0XHRcdFx0cHViKF9fLCAwLCBvYnNlcnZhdGlvbkxldmVsKSxcblx0XHRcdFx0cHViKGRvbVdyYXAoc2VsZWN0b3IsIGZyYWdtZW50Q2xhc3MsIGVsdHMpKV0pO1xuXHR9LFxuXG5cdGhhbmRsZUV2ZW50OiBmdW5jdGlvbiAoZSkge1xuXHQgICAgdmFyIHNlbGYgPSB0aGlzO1xuXHQgICAgaWYgKGUudHlwZSA9PT0gXCJyb3V0ZXNcIikge1xuXHRcdHNlbGYubmV4dFN0YXRlID0gc2VsZi5kaWdlc3RHZXN0YWx0KGUuZ2VzdGFsdCk7XG5cdFx0aWYgKHNlbGYudGltZXIpIHtcblx0XHQgICAgY2xlYXJUaW1lb3V0KHNlbGYudGltZXIpO1xuXHRcdCAgICBzZWxmLnRpbWVyID0gZmFsc2U7XG5cdFx0fVxuXHRcdHNlbGYudGltZXIgPSBzZXRUaW1lb3V0KFdvcmxkLndyYXAoZnVuY3Rpb24gKCkge1xuXHRcdCAgICBpZiAoSlNPTi5zdHJpbmdpZnkoc2VsZi5uZXh0U3RhdGUpICE9PSBKU09OLnN0cmluZ2lmeShzZWxmLnN0YXRlKSkge1xuXHRcdFx0c2VsZi5zdGF0ZSA9IHNlbGYubmV4dFN0YXRlO1xuXHRcdFx0c2VsZi51cGRhdGVTdGF0ZSgpO1xuXHRcdCAgICB9XG5cdFx0ICAgIHNlbGYudGltZXIgPSBmYWxzZTtcblx0XHR9KSwgNTApO1xuXHQgICAgfVxuXHR9XG4gICAgfSk7XG5cbn1cblxubW9kdWxlLmV4cG9ydHMuc3Bhd25Sb3V0aW5nVGFibGVXaWRnZXQgPSBzcGF3blJvdXRpbmdUYWJsZVdpZGdldDtcbiIsIi8vIEdlbmVyaWMgU3B5XG52YXIgTWluaW1hcnQgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIHN1YiA9IE1pbmltYXJ0LnN1YjtcbnZhciBwdWIgPSBNaW5pbWFydC5wdWI7XG52YXIgX18gPSBNaW5pbWFydC5fXztcblxuZnVuY3Rpb24gU3B5KGxhYmVsLCB1c2VKc29uLCBvYnNlcnZhdGlvbkxldmVsKSB7XG4gICAgdGhpcy5sYWJlbCA9IGxhYmVsIHx8IFwiU1BZXCI7XG4gICAgdGhpcy5vYnNlcnZhdGlvbkxldmVsID0gb2JzZXJ2YXRpb25MZXZlbCB8fCAxMDsgLy8gYXJiaXRyYXJ5LiBTaG91bGQgYmUgSW5maW5pdHkuIFRPRE9cbiAgICB0aGlzLnVzZUpzb24gPSB1c2VKc29uO1xufVxuXG5TcHkucHJvdG90eXBlLmJvb3QgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIFtzdWIoX18sIDAsIHRoaXMub2JzZXJ2YXRpb25MZXZlbCksIHB1YihfXywgMCwgdGhpcy5vYnNlcnZhdGlvbkxldmVsKV07XG59O1xuXG5TcHkucHJvdG90eXBlLmhhbmRsZUV2ZW50ID0gZnVuY3Rpb24gKGUpIHtcbiAgICBzd2l0Y2ggKGUudHlwZSkge1xuICAgIGNhc2UgXCJyb3V0ZXNcIjpcblx0Y29uc29sZS5sb2codGhpcy5sYWJlbCwgXCJyb3V0ZXNcIiwgZS5nZXN0YWx0LnByZXR0eSgpKTtcblx0YnJlYWs7XG4gICAgY2FzZSBcIm1lc3NhZ2VcIjpcblx0dmFyIG1lc3NhZ2VSZXByO1xuXHR0cnkge1xuXHQgICAgbWVzc2FnZVJlcHIgPSB0aGlzLnVzZUpzb24gPyBKU09OLnN0cmluZ2lmeShlLm1lc3NhZ2UpIDogZS5tZXNzYWdlO1xuXHR9IGNhdGNoIChleG4pIHtcblx0ICAgIG1lc3NhZ2VSZXByID0gZS5tZXNzYWdlO1xuXHR9XG5cdGNvbnNvbGUubG9nKHRoaXMubGFiZWwsIFwibWVzc2FnZVwiLCBtZXNzYWdlUmVwciwgZS5tZXRhTGV2ZWwsIGUuaXNGZWVkYmFjayk7XG5cdGJyZWFrO1xuICAgIGRlZmF1bHQ6XG5cdGNvbnNvbGUubG9nKHRoaXMubGFiZWwsIFwidW5rbm93blwiLCBlKTtcblx0YnJlYWs7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMuU3B5ID0gU3B5O1xuIiwidmFyIFJlZmxlY3QgPSByZXF1aXJlKFwiLi9yZWZsZWN0LmpzXCIpO1xuXG5tb2R1bGUuZXhwb3J0cy5leHRlbmQgPSBmdW5jdGlvbiAod2hhdCwgX3dpdGgpIHtcbiAgZm9yICh2YXIgcHJvcCBpbiBfd2l0aCkge1xuICAgIGlmIChfd2l0aC5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgd2hhdFtwcm9wXSA9IF93aXRoW3Byb3BdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gd2hhdDtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmt3QXBwbHkgPSBmdW5jdGlvbiAoZiwgdGhpc0FyZywgYXJncykge1xuICB2YXIgZm9ybWFscyA9IFJlZmxlY3QuZm9ybWFsUGFyYW1ldGVycyhmKTtcbiAgdmFyIGFjdHVhbHMgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGZvcm1hbHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgZm9ybWFsID0gZm9ybWFsc1tpXTtcbiAgICBpZiAoIShmb3JtYWwgaW4gYXJncykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZ1bmN0aW9uIHBhcmFtZXRlciAnXCIrZm9ybWFsK1wiJyBub3QgcHJlc2VudCBpbiBhcmdzXCIpO1xuICAgIH1cbiAgICBhY3R1YWxzLnB1c2goYXJnc1tmb3JtYWxdKTtcbiAgfVxuICByZXR1cm4gZi5hcHBseSh0aGlzQXJnLCBhY3R1YWxzKTtcbn07XG4iLCIvLyBXYWtlIGRldGVjdG9yIC0gbm90aWNlcyB3aGVuIHNvbWV0aGluZyAoc3VjaCBhc1xuLy8gc3VzcGVuc2lvbi9zbGVlcGluZyEpIGhhcyBjYXVzZWQgcGVyaW9kaWMgYWN0aXZpdGllcyB0byBiZVxuLy8gaW50ZXJydXB0ZWQsIGFuZCB3YXJucyBvdGhlcnMgYWJvdXQgaXRcbi8vIEluc3BpcmVkIGJ5IGh0dHA6Ly9ibG9nLmFsZXhtYWNjYXcuY29tL2phdmFzY3JpcHQtd2FrZS1ldmVudFxudmFyIE1pbmltYXJ0ID0gcmVxdWlyZShcIi4vbWluaW1hcnQuanNcIik7XG52YXIgV29ybGQgPSBNaW5pbWFydC5Xb3JsZDtcbnZhciBzdWIgPSBNaW5pbWFydC5zdWI7XG52YXIgcHViID0gTWluaW1hcnQucHViO1xudmFyIF9fID0gTWluaW1hcnQuX187XG5cbmZ1bmN0aW9uIFdha2VEZXRlY3RvcihwZXJpb2QpIHtcbiAgICB0aGlzLm1lc3NhZ2UgPSBcIndha2VcIjtcbiAgICB0aGlzLnBlcmlvZCA9IHBlcmlvZCB8fCAxMDAwMDtcbiAgICB0aGlzLm1vc3RSZWNlbnRUcmlnZ2VyID0gKyhuZXcgRGF0ZSgpKTtcbiAgICB0aGlzLnRpbWVySWQgPSBudWxsO1xufVxuXG5XYWtlRGV0ZWN0b3IucHJvdG90eXBlLmJvb3QgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMudGltZXJJZCA9IHNldEludGVydmFsKFdvcmxkLndyYXAoZnVuY3Rpb24gKCkgeyBzZWxmLnRyaWdnZXIoKTsgfSksIHRoaXMucGVyaW9kKTtcbiAgICByZXR1cm4gW3B1Yih0aGlzLm1lc3NhZ2UpXTtcbn07XG5cbldha2VEZXRlY3Rvci5wcm90b3R5cGUuaGFuZGxlRXZlbnQgPSBmdW5jdGlvbiAoZSkge307XG5cbldha2VEZXRlY3Rvci5wcm90b3R5cGUudHJpZ2dlciA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgbm93ID0gKyhuZXcgRGF0ZSgpKTtcbiAgICBpZiAobm93IC0gdGhpcy5tb3N0UmVjZW50VHJpZ2dlciA+IHRoaXMucGVyaW9kICogMS41KSB7XG5cdFdvcmxkLnNlbmQodGhpcy5tZXNzYWdlKTtcbiAgICB9XG4gICAgdGhpcy5tb3N0UmVjZW50VHJpZ2dlciA9IG5vdztcbn07XG5cbm1vZHVsZS5leHBvcnRzLldha2VEZXRlY3RvciA9IFdha2VEZXRlY3RvcjtcbiIsInZhciBNaW5pbWFydCA9IHJlcXVpcmUoXCIuL21pbmltYXJ0LmpzXCIpO1xudmFyIENvZGVjID0gcmVxdWlyZShcIi4vY29kZWMuanNcIik7XG52YXIgUm91dGUgPSBNaW5pbWFydC5Sb3V0ZTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIHN1YiA9IE1pbmltYXJ0LnN1YjtcbnZhciBwdWIgPSBNaW5pbWFydC5wdWI7XG52YXIgX18gPSBNaW5pbWFydC5fXztcbnZhciBfJCA9IE1pbmltYXJ0Ll8kO1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cbi8vIFdlYlNvY2tldCBjbGllbnQgZHJpdmVyXG5cbnZhciBERUZBVUxUX1JFQ09OTkVDVF9ERUxBWSA9IDEwMDtcbnZhciBNQVhfUkVDT05ORUNUX0RFTEFZID0gMzAwMDA7XG52YXIgREVGQVVMVF9JRExFX1RJTUVPVVQgPSAzMDAwMDA7IC8vIDUgbWludXRlc1xudmFyIERFRkFVTFRfUElOR19JTlRFUlZBTCA9IERFRkFVTFRfSURMRV9USU1FT1VUIC0gMTAwMDA7XG5cbmZ1bmN0aW9uIFdlYlNvY2tldENvbm5lY3Rpb24obGFiZWwsIHdzdXJsLCBzaG91bGRSZWNvbm5lY3QpIHtcbiAgICB0aGlzLmxhYmVsID0gbGFiZWw7XG4gICAgdGhpcy5zZW5kc0F0dGVtcHRlZCA9IDA7XG4gICAgdGhpcy5zZW5kc1RyYW5zbWl0dGVkID0gMDtcbiAgICB0aGlzLnJlY2VpdmVDb3VudCA9IDA7XG4gICAgdGhpcy5zb2NrID0gbnVsbDtcbiAgICB0aGlzLndzdXJsID0gd3N1cmw7XG4gICAgdGhpcy5zaG91bGRSZWNvbm5lY3QgPSBzaG91bGRSZWNvbm5lY3QgPyB0cnVlIDogZmFsc2U7XG4gICAgdGhpcy5yZWNvbm5lY3REZWxheSA9IERFRkFVTFRfUkVDT05ORUNUX0RFTEFZO1xuICAgIHRoaXMubG9jYWxHZXN0YWx0ID0gUm91dGUuZW1wdHlHZXN0YWx0O1xuICAgIHRoaXMucGVlckdlc3RhbHQgPSBSb3V0ZS5lbXB0eUdlc3RhbHQ7XG4gICAgdGhpcy5wcmV2TG9jYWxSb3V0ZXNNZXNzYWdlID0gbnVsbDtcbiAgICB0aGlzLnByZXZQZWVyUm91dGVzTWVzc2FnZSA9IG51bGw7XG4gICAgdGhpcy5kZWR1cGxpY2F0b3IgPSBuZXcgTWluaW1hcnQuRGVkdXBsaWNhdG9yKCk7XG4gICAgdGhpcy5jb25uZWN0aW9uQ291bnQgPSAwO1xuXG4gICAgdGhpcy5hY3Rpdml0eVRpbWVzdGFtcCA9IDA7XG4gICAgdGhpcy5pZGxlVGltZW91dCA9IERFRkFVTFRfSURMRV9USU1FT1VUO1xuICAgIHRoaXMucGluZ0ludGVydmFsID0gREVGQVVMVF9QSU5HX0lOVEVSVkFMO1xuICAgIHRoaXMuaWRsZVRpbWVyID0gbnVsbDtcbiAgICB0aGlzLnBpbmdUaW1lciA9IG51bGw7XG59XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLmRlYnVnU3RhdGUgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IHRoaXMubGFiZWwsXG4gICAgc2VuZHNBdHRlbXB0ZWQ6IHRoaXMuc2VuZHNBdHRlbXB0ZWQsXG4gICAgc2VuZHNUcmFuc21pdHRlZDogdGhpcy5zZW5kc1RyYW5zbWl0dGVkLFxuICAgIHJlY2VpdmVDb3VudDogdGhpcy5yZWNlaXZlQ291bnQsXG4gICAgd3N1cmw6IHRoaXMud3N1cmwsXG4gICAgc2hvdWxkUmVjb25uZWN0OiB0aGlzLnNob3VsZFJlY29ubmVjdCxcbiAgICByZWNvbm5lY3REZWxheTogdGhpcy5yZWNvbm5lY3REZWxheSxcbiAgICBjb25uZWN0aW9uQ291bnQ6IHRoaXMuY29ubmVjdGlvbkNvdW50LFxuICAgIGFjdGl2aXR5VGltZXN0YW1wOiB0aGlzLmFjdGl2aXR5VGltZXN0YW1wXG4gIH07XG59O1xuXG5XZWJTb2NrZXRDb25uZWN0aW9uLnByb3RvdHlwZS5jbGVhckhlYXJ0YmVhdFRpbWVycyA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAodGhpcy5pZGxlVGltZXIpIHsgY2xlYXJUaW1lb3V0KHRoaXMuaWRsZVRpbWVyKTsgdGhpcy5pZGxlVGltZXIgPSBudWxsOyB9XG4gICAgaWYgKHRoaXMucGluZ1RpbWVyKSB7IGNsZWFyVGltZW91dCh0aGlzLnBpbmdUaW1lcik7IHRoaXMucGluZ1RpbWVyID0gbnVsbDsgfVxufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUucmVjb3JkQWN0aXZpdHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuYWN0aXZpdHlUaW1lc3RhbXAgPSArKG5ldyBEYXRlKCkpO1xuICAgIHRoaXMuY2xlYXJIZWFydGJlYXRUaW1lcnMoKTtcbiAgICB0aGlzLmlkbGVUaW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24gKCkgeyBzZWxmLmZvcmNlY2xvc2UoKTsgfSxcblx0XHRcdFx0dGhpcy5pZGxlVGltZW91dCk7XG4gICAgdGhpcy5waW5nVGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgc2VsZi5zYWZlU2VuZChKU09OLnN0cmluZ2lmeShcInBpbmdcIikpIH0sXG5cdFx0XHRcdHRoaXMucGluZ0ludGVydmFsKTtcbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLnN0YXR1c1JvdXRlID0gZnVuY3Rpb24gKHN0YXR1cykge1xuICAgIHJldHVybiBwdWIoW3RoaXMubGFiZWwgKyBcIl9zdGF0ZVwiLCBzdGF0dXNdKTtcbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLnJlbGF5R2VzdGFsdCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0dXNSb3V0ZSh0aGlzLmlzQ29ubmVjdGVkKCkgPyBcImNvbm5lY3RlZFwiIDogXCJkaXNjb25uZWN0ZWRcIilcblx0LnVuaW9uKHB1YihbdGhpcy5sYWJlbCwgX18sIF9fXSwgMCwgMTApKVxuXHQudW5pb24oc3ViKFt0aGlzLmxhYmVsLCBfXywgX19dLCAwLCAxMCkpO1xuICAgIC8vIFRPRE86IGxldmVsIDEwIGlzIGFkLWhvYzsgc3VwcG9ydCBpbmZpbml0eSBhdCBzb21lIHBvaW50IGluIGZ1dHVyZVxufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUuYWdncmVnYXRlR2VzdGFsdCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHRoaXMucGVlckdlc3RhbHQudHJhbnNmb3JtKGZ1bmN0aW9uIChtLCBtZXRhTGV2ZWwpIHtcblx0cmV0dXJuIFJvdXRlLmNvbXBpbGVQYXR0ZXJuKHRydWUsXG5cdFx0XHRcdCAgICBbc2VsZi5sYWJlbCwgbWV0YUxldmVsLCBSb3V0ZS5lbWJlZGRlZE1hdGNoZXIobSldKTtcbiAgICB9KS51bmlvbih0aGlzLnJlbGF5R2VzdGFsdCgpKTtcbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLmJvb3QgPSBmdW5jdGlvbiAoKSB7XG4gICAgdGhpcy5yZWNvbm5lY3QoKTtcbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLnRyYXBleGl0ID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZm9yY2VjbG9zZSgpO1xufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUuaXNDb25uZWN0ZWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuc29jayAmJiB0aGlzLnNvY2sucmVhZHlTdGF0ZSA9PT0gdGhpcy5zb2NrLk9QRU47XG59O1xuXG5XZWJTb2NrZXRDb25uZWN0aW9uLnByb3RvdHlwZS5zYWZlU2VuZCA9IGZ1bmN0aW9uIChtKSB7XG4gICAgdHJ5IHtcblx0dGhpcy5zZW5kc0F0dGVtcHRlZCsrO1xuXHRpZiAodGhpcy5pc0Nvbm5lY3RlZCgpKSB7XG5cdCAgICB0aGlzLnNvY2suc2VuZChtKTtcblx0ICAgIHRoaXMuc2VuZHNUcmFuc21pdHRlZCsrO1xuXHR9XG4gICAgfSBjYXRjaCAoZSkge1xuXHRjb25zb2xlLndhcm4oXCJUcmFwcGVkIGV4biB3aGlsZSBzZW5kaW5nXCIsIGUpO1xuICAgIH1cbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLnNlbmRMb2NhbFJvdXRlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgbmV3TG9jYWxSb3V0ZXNNZXNzYWdlID1cblx0SlNPTi5zdHJpbmdpZnkoQ29kZWMuZW5jb2RlRXZlbnQoTWluaW1hcnQudXBkYXRlUm91dGVzKFt0aGlzLmxvY2FsR2VzdGFsdF0pKSk7XG4gICAgaWYgKHRoaXMucHJldkxvY2FsUm91dGVzTWVzc2FnZSAhPT0gbmV3TG9jYWxSb3V0ZXNNZXNzYWdlKSB7XG5cdHRoaXMucHJldkxvY2FsUm91dGVzTWVzc2FnZSA9IG5ld0xvY2FsUm91dGVzTWVzc2FnZTtcblx0dGhpcy5zYWZlU2VuZChuZXdMb2NhbFJvdXRlc01lc3NhZ2UpO1xuICAgIH1cbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLmNvbGxlY3RNYXRjaGVycyA9IGZ1bmN0aW9uIChnZXRBZHZlcnRpc2VtZW50cywgbGV2ZWwsIGcpIHtcbiAgICB2YXIgZXh0cmFjdE1ldGFMZXZlbHMgPSBSb3V0ZS5jb21waWxlUHJvamVjdGlvbihbdGhpcy5sYWJlbCwgXyQsIF9fXSk7XG4gICAgdmFyIG1scyA9IFJvdXRlLm1hdGNoZXJLZXlzKGcucHJvamVjdChleHRyYWN0TWV0YUxldmVscywgZ2V0QWR2ZXJ0aXNlbWVudHMsIDAsIGxldmVsKSk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtbHMubGVuZ3RoOyBpKyspIHtcblx0dmFyIG1ldGFMZXZlbCA9IG1sc1tpXVswXTsgLy8gb25seSBvbmUgY2FwdHVyZSBpbiB0aGUgcHJvamVjdGlvblxuXHR2YXIgZXh0cmFjdE1hdGNoZXJzID0gUm91dGUuY29tcGlsZVByb2plY3Rpb24oW3RoaXMubGFiZWwsIG1ldGFMZXZlbCwgXyRdKTtcblx0dmFyIG0gPSBnLnByb2plY3QoZXh0cmFjdE1hdGNoZXJzLCBnZXRBZHZlcnRpc2VtZW50cywgMCwgbGV2ZWwpO1xuXHR0aGlzLmxvY2FsR2VzdGFsdCA9IHRoaXMubG9jYWxHZXN0YWx0LnVuaW9uKFJvdXRlLnNpbXBsZUdlc3RhbHQoZ2V0QWR2ZXJ0aXNlbWVudHMsXG5cdFx0XHRcdFx0XHRcdFx0XHRSb3V0ZS5lbWJlZGRlZE1hdGNoZXIobSksXG5cdFx0XHRcdFx0XHRcdFx0XHRtZXRhTGV2ZWwsXG5cdFx0XHRcdFx0XHRcdFx0XHRsZXZlbCkpO1xuICAgIH1cbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLmhhbmRsZUV2ZW50ID0gZnVuY3Rpb24gKGUpIHtcbiAgICAvLyBjb25zb2xlLmxvZyhcIldlYlNvY2tldENvbm5lY3Rpb24uaGFuZGxlRXZlbnRcIiwgZSk7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICBjYXNlIFwicm91dGVzXCI6XG5cdC8vIFRPRE86IEdST1NTIC0gZXJhc2luZyBieSBwaWQhXG5cdHZhciBuTGV2ZWxzID0gZS5nZXN0YWx0LmxldmVsQ291bnQoMCk7XG5cdHZhciByZWxheUdlc3RhbHQgPSBSb3V0ZS5mdWxsR2VzdGFsdCgxLCBuTGV2ZWxzKS5sYWJlbChXb3JsZC5hY3RpdmVQaWQoKSk7XG5cdHZhciBnID0gZS5nZXN0YWx0LmVyYXNlUGF0aChyZWxheUdlc3RhbHQpO1xuXHR0aGlzLmxvY2FsR2VzdGFsdCA9IFJvdXRlLmVtcHR5R2VzdGFsdDtcblx0Zm9yICh2YXIgbGV2ZWwgPSAwOyBsZXZlbCA8IG5MZXZlbHM7IGxldmVsKyspIHtcblx0ICAgIHRoaXMuY29sbGVjdE1hdGNoZXJzKGZhbHNlLCBsZXZlbCwgZyk7XG5cdCAgICB0aGlzLmNvbGxlY3RNYXRjaGVycyh0cnVlLCBsZXZlbCwgZyk7XG5cdH1cblxuXHR0aGlzLnNlbmRMb2NhbFJvdXRlcygpO1xuXHRicmVhaztcbiAgICBjYXNlIFwibWVzc2FnZVwiOlxuXHR2YXIgbSA9IGUubWVzc2FnZTtcblx0aWYgKG0ubGVuZ3RoICYmIG0ubGVuZ3RoID09PSAzICYmIG1bMF0gPT09IHRoaXMubGFiZWwpXG5cdHtcblx0ICAgIHZhciBlbmNvZGVkID0gSlNPTi5zdHJpbmdpZnkoQ29kZWMuZW5jb2RlRXZlbnQoXG5cdFx0TWluaW1hcnQuc2VuZE1lc3NhZ2UobVsyXSwgbVsxXSwgZS5pc0ZlZWRiYWNrKSkpO1xuXHQgICAgaWYgKHRoaXMuZGVkdXBsaWNhdG9yLmFjY2VwdChlbmNvZGVkKSkge1xuXHRcdHRoaXMuc2FmZVNlbmQoZW5jb2RlZCk7XG5cdCAgICB9XG5cdH1cblx0YnJlYWs7XG4gICAgfVxufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUuZm9yY2VjbG9zZSA9IGZ1bmN0aW9uIChrZWVwUmVjb25uZWN0RGVsYXkpIHtcbiAgICBpZiAoIWtlZXBSZWNvbm5lY3REZWxheSkge1xuXHR0aGlzLnJlY29ubmVjdERlbGF5ID0gREVGQVVMVF9SRUNPTk5FQ1RfREVMQVk7XG4gICAgfVxuICAgIHRoaXMuY2xlYXJIZWFydGJlYXRUaW1lcnMoKTtcbiAgICBpZiAodGhpcy5zb2NrKSB7XG5cdGNvbnNvbGUubG9nKFwiV2ViU29ja2V0Q29ubmVjdGlvbi5mb3JjZWNsb3NlIGNhbGxlZFwiKTtcblx0dGhpcy5zb2NrLmNsb3NlKCk7XG5cdHRoaXMuc29jayA9IG51bGw7XG4gICAgfVxufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUucmVjb25uZWN0ID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmZvcmNlY2xvc2UodHJ1ZSk7XG4gICAgdGhpcy5jb25uZWN0aW9uQ291bnQrKztcbiAgICB0aGlzLnNvY2sgPSBuZXcgV2ViU29ja2V0KHRoaXMud3N1cmwpO1xuICAgIHRoaXMuc29jay5vbm9wZW4gPSBXb3JsZC53cmFwKGZ1bmN0aW9uIChlKSB7IHJldHVybiBzZWxmLm9ub3BlbihlKTsgfSk7XG4gICAgdGhpcy5zb2NrLm9ubWVzc2FnZSA9IFdvcmxkLndyYXAoZnVuY3Rpb24gKGUpIHtcblx0c2VsZi5yZWNlaXZlQ291bnQrKztcblx0cmV0dXJuIHNlbGYub25tZXNzYWdlKGUpO1xuICAgIH0pO1xuICAgIHRoaXMuc29jay5vbmNsb3NlID0gV29ybGQud3JhcChmdW5jdGlvbiAoZSkgeyByZXR1cm4gc2VsZi5vbmNsb3NlKGUpOyB9KTtcbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLm9ub3BlbiA9IGZ1bmN0aW9uIChlKSB7XG4gICAgY29uc29sZS5sb2coXCJjb25uZWN0ZWQgdG8gXCIgKyB0aGlzLnNvY2sudXJsKTtcbiAgICB0aGlzLnJlY29ubmVjdERlbGF5ID0gREVGQVVMVF9SRUNPTk5FQ1RfREVMQVk7XG4gICAgdGhpcy5wcmV2TG9jYWxSb3V0ZXNNZXNzYWdlID0gbnVsbDtcbiAgICB0aGlzLnNlbmRMb2NhbFJvdXRlcygpO1xufTtcblxuV2ViU29ja2V0Q29ubmVjdGlvbi5wcm90b3R5cGUub25tZXNzYWdlID0gZnVuY3Rpb24gKHdzZSkge1xuICAgIC8vIGNvbnNvbGUubG9nKFwib25tZXNzYWdlXCIsIHdzZSk7XG4gICAgdGhpcy5yZWNvcmRBY3Rpdml0eSgpO1xuXG4gICAgdmFyIGogPSBKU09OLnBhcnNlKHdzZS5kYXRhKTtcbiAgICBpZiAoaiA9PT0gXCJwaW5nXCIpIHtcblx0dGhpcy5zYWZlU2VuZChKU09OLnN0cmluZ2lmeShcInBvbmdcIikpO1xuXHRyZXR1cm47XG4gICAgfSBlbHNlIGlmIChqID09PSBcInBvbmdcIikge1xuXHRyZXR1cm47IC8vIHJlY29yZEFjdGl2aXR5IGFscmVhZHkgdG9vayBjYXJlIG9mIG91ciB0aW1lcnNcbiAgICB9XG5cbiAgICB2YXIgZSA9IENvZGVjLmRlY29kZUFjdGlvbihqKTtcbiAgICBzd2l0Y2ggKGUudHlwZSkge1xuICAgIGNhc2UgXCJyb3V0ZXNcIjpcblx0aWYgKHRoaXMucHJldlBlZXJSb3V0ZXNNZXNzYWdlICE9PSB3c2UuZGF0YSkge1xuXHQgICAgdGhpcy5wcmV2UGVlclJvdXRlc01lc3NhZ2UgPSB3c2UuZGF0YTtcblx0ICAgIHRoaXMucGVlckdlc3RhbHQgPSBlLmdlc3RhbHQ7XG5cdCAgICBXb3JsZC51cGRhdGVSb3V0ZXMoW3RoaXMuYWdncmVnYXRlR2VzdGFsdCgpXSk7XG5cdH1cblx0YnJlYWs7XG4gICAgY2FzZSBcIm1lc3NhZ2VcIjpcblx0aWYgKHRoaXMuZGVkdXBsaWNhdG9yLmFjY2VwdCh3c2UuZGF0YSkpIHtcblx0ICAgIFdvcmxkLnNlbmQoW3RoaXMubGFiZWwsIGUubWV0YUxldmVsLCBlLm1lc3NhZ2VdLCAwLCBlLmlzRmVlZGJhY2spO1xuXHR9XG5cdGJyZWFrO1xuICAgIH1cbn07XG5cbldlYlNvY2tldENvbm5lY3Rpb24ucHJvdG90eXBlLm9uY2xvc2UgPSBmdW5jdGlvbiAoZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBjb25zb2xlLmxvZyhcIm9uY2xvc2VcIiwgZSk7XG5cbiAgICAvLyBVcGRhdGUgcm91dGVzIHRvIGdpdmUgY2xpZW50cyBzb21lIGluZGljYXRpb24gb2YgdGhlIGRpc2NvbnRpbnVpdHlcbiAgICBXb3JsZC51cGRhdGVSb3V0ZXMoW3RoaXMuYWdncmVnYXRlR2VzdGFsdCgpXSk7XG5cbiAgICBpZiAodGhpcy5zaG91bGRSZWNvbm5lY3QpIHtcblx0Y29uc29sZS5sb2coXCJyZWNvbm5lY3RpbmcgdG8gXCIgKyB0aGlzLndzdXJsICsgXCIgaW4gXCIgKyB0aGlzLnJlY29ubmVjdERlbGF5ICsgXCJtc1wiKTtcblx0c2V0VGltZW91dChXb3JsZC53cmFwKGZ1bmN0aW9uICgpIHsgc2VsZi5yZWNvbm5lY3QoKTsgfSksIHRoaXMucmVjb25uZWN0RGVsYXkpO1xuXHR0aGlzLnJlY29ubmVjdERlbGF5ID0gdGhpcy5yZWNvbm5lY3REZWxheSAqIDEuNjE4ICsgKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcblx0dGhpcy5yZWNvbm5lY3REZWxheSA9XG5cdCAgICB0aGlzLnJlY29ubmVjdERlbGF5ID4gTUFYX1JFQ09OTkVDVF9ERUxBWVxuXHQgICAgPyBNQVhfUkVDT05ORUNUX0RFTEFZICsgKE1hdGgucmFuZG9tKCkgKiAxMDAwKVxuXHQgICAgOiB0aGlzLnJlY29ubmVjdERlbGF5O1xuICAgIH1cbn07XG5cbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG5tb2R1bGUuZXhwb3J0cy5XZWJTb2NrZXRDb25uZWN0aW9uID0gV2ViU29ja2V0Q29ubmVjdGlvbjtcbiIsIi8qIFdlYiBXb3JrZXIgaW50ZXJmYWNlICovXG52YXIgR3JvdW5kID0gcmVxdWlyZShcIi4vZ3JvdW5kLmpzXCIpLkdyb3VuZDtcbnZhciBVdGlsID0gcmVxdWlyZShcIi4vdXRpbC5qc1wiKTtcbnZhciBDb2RlYyA9IHJlcXVpcmUoXCIuL2NvZGVjLmpzXCIpO1xuXG52YXIgTWluaW1hcnQgPSByZXF1aXJlKFwiLi9taW5pbWFydC5qc1wiKTtcbnZhciBXb3JsZCA9IE1pbmltYXJ0LldvcmxkO1xudmFyIHN1YiA9IE1pbmltYXJ0LnN1YjtcbnZhciBwdWIgPSBNaW5pbWFydC5wdWI7XG52YXIgX18gPSBNaW5pbWFydC5fXztcblxudmFyIEJ1aWx0aW5Xb3JrZXIgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cuV29ya2VyO1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuZnVuY3Rpb24gV29ya2VyKHNjcmlwdFVybCkge1xuICB0aGlzLnNjcmlwdFVybCA9IHNjcmlwdFVybDtcbiAgdGhpcy53ID0gbmV3IEJ1aWx0aW5Xb3JrZXIoc2NyaXB0VXJsKTtcbn1cblxuV29ya2VyLnByb3RvdHlwZS5ib290ID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLncub25tZXNzYWdlID0gV29ybGQud3JhcChmdW5jdGlvbiAoZSkge1xuICAgIGNvbnNvbGUubG9nKFwiUmVjZWl2ZWQgZnJvbSB3b3JrZXJcIiwgSlNPTi5zdHJpbmdpZnkoZS5kYXRhKSk7XG4gICAgV29ybGQuY3VycmVudCgpLmVucXVldWVBY3Rpb24oV29ybGQuYWN0aXZlUGlkKCksIENvZGVjLmRlY29kZUFjdGlvbihlLmRhdGEpKTtcbiAgfSk7XG59O1xuXG5Xb3JrZXIucHJvdG90eXBlLmhhbmRsZUV2ZW50ID0gZnVuY3Rpb24gKGUpIHtcbiAgY29uc29sZS5sb2coXCJTZW5kaW5nIHRvIHdvcmtlclwiLCBKU09OLnN0cmluZ2lmeShDb2RlYy5lbmNvZGVFdmVudChlKSkpO1xuICB0aGlzLncucG9zdE1lc3NhZ2UoQ29kZWMuZW5jb2RlRXZlbnQoZSkpO1xufTtcblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbmZ1bmN0aW9uIFdvcmtlckdyb3VuZChib290Rm4pIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBHcm91bmQuY2FsbCh0aGlzLCBib290Rm4pO1xuICBvbm1lc3NhZ2UgPSBmdW5jdGlvbiAoZSkge1xuICAgIGNvbnNvbGUubG9nKFwiUmVjZWl2ZWQgZnJvbSBtYWluIHBhZ2VcIiwgSlNPTi5zdHJpbmdpZnkoZS5kYXRhKSk7XG4gICAgc2VsZi53b3JsZC5oYW5kbGVFdmVudChDb2RlYy5kZWNvZGVFdmVudChlLmRhdGEpKTtcbiAgICBzZWxmLnN0YXJ0U3RlcHBpbmcoKTtcbiAgfTtcbn1cblxuV29ya2VyR3JvdW5kLnByb3RvdHlwZSA9IFV0aWwuZXh0ZW5kKHt9LCBHcm91bmQucHJvdG90eXBlKTtcblxuV29ya2VyR3JvdW5kLnByb3RvdHlwZS5lbnF1ZXVlQWN0aW9uID0gZnVuY3Rpb24gKHBpZCwgYWN0aW9uKSB7XG4gIGNvbnNvbGUubG9nKFwiU2VuZGluZyB0byBtYWluIHBhZ2VcIiwgSlNPTi5zdHJpbmdpZnkoQ29kZWMuZW5jb2RlQWN0aW9uKGFjdGlvbikpKTtcbiAgcG9zdE1lc3NhZ2UoQ29kZWMuZW5jb2RlQWN0aW9uKGFjdGlvbikpO1xuICBjb25zb2xlLmxvZyhcIlNlbnQgdG8gbWFpbiBwYWdlXCIpO1xufTtcblxuLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbm1vZHVsZS5leHBvcnRzLldvcmtlciA9IFdvcmtlcjtcbm1vZHVsZS5leHBvcnRzLldvcmtlckdyb3VuZCA9IFdvcmtlckdyb3VuZDtcbiJdfQ==
(6)
});
