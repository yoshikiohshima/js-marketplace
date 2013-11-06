///////////////////////////////////////////////////////////////////////////
// Wire protocol representation of events and actions

function encodeEvent(e) {
    switch (e.type) {
    case "routes":
	var rs = [];
	for (var i = 0; i < e.routes.length; i++) {
	    rs.push(e.routes[i].toJSON());
	}
	return ["routes", rs];
    case "message":
	return ["message", e.message, e.metaLevel, e.isFeedback];
    }
}

function decodeAction(j) {
    switch (j[0]) {
    case "routes":
	var rs = [];
	for (var i = 0; i < j[1].length; i++) {
	    rs.push(Route.fromJSON(j[1][i]));
	}
	return updateRoutes(rs);
    case "message":
	return sendMessage(j[1], j[2], j[3]);
    default:
	throw { message: "Invalid JSON-encoded action: " + JSON.stringify(j) };
    }
}

///////////////////////////////////////////////////////////////////////////
// Generic Spy

function Spy() {
}

Spy.prototype.boot = function () {
    World.updateRoutes([sub(__, 0, Infinity), pub(__, 0, Infinity)]);
};

Spy.prototype.handleEvent = function (e) {
    switch (e.type) {
    case "routes": console.log("SPY", "routes", e.routes); break;
    case "message": console.log("SPY", "message", e.message, e.metaLevel, e.isFeedback); break;
    default: console.log("SPY", "unknown", e); break;
    }
};

///////////////////////////////////////////////////////////////////////////
// JQuery event driver

function spawnJQueryDriver() {
    var d = new DemandMatcher(["jQuery", __, __, __]);
    d.onDemandIncrease = function (r) {
	var selector = r.pattern[1];
	var eventName = r.pattern[2];
	World.spawn(new JQueryEventRouter(selector, eventName),
		    [pub(["jQuery", selector, eventName, __]),
		     pub(["jQuery", selector, eventName, __], 0, 1)]);
    };
    World.spawn(d);
}

function JQueryEventRouter(selector, eventName) {
    var self = this;
    this.selector = selector;
    this.eventName = eventName;
    this.handler =
	World.wrap(function (e) {
	    World.send(["jQuery", self.selector, self.eventName, e]);
	    e.preventDefault();
	    return false;
	});
    $(this.selector).on(this.eventName, this.handler);
}

JQueryEventRouter.prototype.handleEvent = function (e) {
    if (e.type === "routes" && e.routes.length === 0) {
	$(this.selector).off(this.eventName, this.handler);
	World.exit();
    }
};

///////////////////////////////////////////////////////////////////////////
// Wake detector - notices when something (such as
// suspension/sleeping!) has caused periodic activities to be
// interrupted, and warns others about it
// Inspired by http://blog.alexmaccaw.com/javascript-wake-event

function WakeDetector(period) {
    this.message = "wake";
    this.period = period || 10000;
    this.mostRecentTrigger = +(new Date());
    this.timerId = null;
}

WakeDetector.prototype.boot = function () {
    var self = this;
    World.updateRoutes([pub(this.message)]);
    this.timerId = setInterval(World.wrap(function () { self.trigger(); }), this.period);
};

WakeDetector.prototype.handleEvent = function (e) {};

WakeDetector.prototype.trigger = function () {
    var now = +(new Date());
    if (now - this.mostRecentTrigger > this.period * 1.5) {
	World.send(this.message);
    }
    this.mostRecentTrigger = now;
};

///////////////////////////////////////////////////////////////////////////
// WebSocket client driver

var DEFAULT_RECONNECT_DELAY = 100;
var MAX_RECONNECT_DELAY = 30000;
var DEFAULT_IDLE_TIMEOUT = 300000; // 5 minutes
var DEFAULT_PING_INTERVAL = DEFAULT_IDLE_TIMEOUT - 10000;

function WebSocketConnection(label, wsurl, shouldReconnect) {
    this.label = label;
    this.wsurl = wsurl;
    this.shouldReconnect = shouldReconnect ? true : false;
    this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
    this.localRoutes = [];
    this.peerRoutes = [];
    this.prevPeerRoutesMessage = null;
    this.sock = null;
    this.deduplicator = new Deduplicator();

    this.activityTimestamp = 0;
    this.idleTimeout = DEFAULT_IDLE_TIMEOUT;
    this.pingInterval = DEFAULT_PING_INTERVAL;
    this.idleTimer = null;
    this.pingTimer = null;
}

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

WebSocketConnection.prototype.relayRoutes = function () {
    // fresh copy each time, suitable for in-place extension/mutation
    return [this.statusRoute(this.isConnected() ? "connected" : "disconnected"),
	    pub([this.label, __, __], 0, 1000),
	    sub([this.label, __, __], 0, 1000)];
};

WebSocketConnection.prototype.aggregateRoutes = function () {
    var rs = this.relayRoutes();
    for (var i = 0; i < this.peerRoutes.length; i++) {
	var r = this.peerRoutes[i];
	rs.push(new Route(r.isSubscription,
			  [this.label, __, r.pattern],
			  r.metaLevel,
			  r.level));
    }
    // console.log("WebSocketConnection.aggregateRoutes", this.label, rs);
    return rs;
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
	if (this.isConnected()) { this.sock.send(m); }
    } catch (e) {
	console.warn("Trapped exn while sending", e);
    }
};

WebSocketConnection.prototype.sendLocalRoutes = function () {
    this.safeSend(JSON.stringify(encodeEvent(updateRoutes(this.localRoutes))));
};

WebSocketConnection.prototype.handleEvent = function (e) {
    // console.log("WebSocketConnection.handleEvent", e);
    switch (e.type) {
    case "routes":
	this.localRoutes = [];
	for (var i = 0; i < e.routes.length; i++) {
	    var r = e.routes[i];
	    if (r.pattern.length && r.pattern.length === 3
		&& r.pattern[0] === this.label
		&& typeof(r.pattern[1]) === "number")
	    {
		this.localRoutes.push(new Route(r.isSubscription,
						r.pattern[2],
						r.pattern[1],
						r.level));
	    }
	}
	this.sendLocalRoutes();
	break;
    case "message":
	var m = e.message;
	if (m.length && m.length === 3
	    && m[0] === this.label
	    && typeof(m[1]) === "number")
	{
	    var encoded = JSON.stringify(encodeEvent(sendMessage(m[2], m[1], e.isFeedback)));
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
    this.sock = new WebSocket(this.wsurl);
    this.sock.onopen = World.wrap(function (e) { return self.onopen(e); });
    this.sock.onmessage = World.wrap(function (e) { return self.onmessage(e); });
    this.sock.onclose = World.wrap(function (e) { return self.onclose(e); });
};

WebSocketConnection.prototype.onopen = function (e) {
    console.log("connected to " + this.sock.url);
    this.reconnectDelay = DEFAULT_RECONNECT_DELAY;
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

    var e = decodeAction(j);
    switch (e.type) {
    case "routes":
	if (this.prevPeerRoutesMessage !== wse.data) {
	    this.prevPeerRoutesMessage = wse.data;
	    this.peerRoutes = e.routes;
	    World.updateRoutes(this.aggregateRoutes());
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
    World.updateRoutes(this.aggregateRoutes());

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
// Main

function chatEvent(nym, status, utterance, stamp) {
    return ["chatEvent", nym, status, utterance, stamp || +(new Date())];
}
function chatEventNym(c) { return c[1]; }
function chatEventStatus(c) { return c[2]; }
function chatEventUtterance(c) { return c[3]; }
function chatEventStamp(c) { return c[4]; }

function outputItem(item) {
    var stamp = $("<span/>").text((new Date()).toGMTString()).addClass("timestamp");
    var item = $("<div/>").append([stamp].concat(item));
    var o = $("#chat_output");
    o.append(item);
    o[0].scrollTop = o[0].scrollHeight;
    return item;
}

function updateNymList(rs) {
    var statuses = {};
    for (var i = 0; i < rs.length; i++) {
	var p = rs[i].pattern;
	if (p[0] === "broker" && p[1] === 0 && p[2][0] === "chatEvent") {
	    statuses[chatEventNym(p[2])] = chatEventStatus(p[2]);
	}
    }
    var nyms = [];
    for (var nym in statuses) { nyms.push(nym); }
    nyms.sort();

    var container = $("#nymlist");
    container[0].innerHTML = ""; // remove all children
    for (var i = 0; i < nyms.length; i++) {
	var n = $("<span/>").text(nyms[i]).addClass("nym");
	var s = statuses[nyms[i]];
	if (s) {
	    container.append($("<div/>").append([n, $("<span/>").text(s).addClass("nym_status")]));
	} else {
	    container.append($("<div/>").append(n));
	}
    }
}

function outputState(state) {
    outputItem([$("<span/>").text(state).addClass(state).addClass("state")])
    .addClass("state_" + state);
}

function outputUtterance(who, what) {
    outputItem([$("<span/>").text(who).addClass("nym"),
		$("<span/>").text(what).addClass("utterance")]).addClass("utterance");
}

var G;
$(document).ready(function () {
    $("#chat_form").submit(function (e) { e.preventDefault(); return false; });
    $("#nym_form").submit(function (e) { e.preventDefault(); return false; });
    if (!($("#nym").val())) { $("#nym").val("nym" + Math.floor(Math.random() * 65536)); }

    G = new Ground(function () {
	console.log('starting ground boot');
	// World.spawn(new Spy());
	spawnJQueryDriver();
	World.spawn(new WakeDetector());
	var wsconn = new WebSocketConnection("broker", $("#wsurl").val(), true);
	World.spawn(wsconn);
	World.spawn({
	    // Monitor connection, notifying connectivity changes
	    state: "crashed", // start with this to avoid spurious initial message print
	    boot: function () {
		World.updateRoutes([sub(["broker_state", __], 0, 1)]);
	    },
	    handleEvent: function (e) {
		if (e.type === "routes") {
		    var newState = (e.routes.length > 0) ? e.routes[0].pattern[1] : "crashed";
		    if (this.state != newState) {
			outputState(newState);
			this.state = newState;
		    }
		}
	    }
	});
	World.spawn({
	    // Actual chat functionality
	    peers: new PresenceDetector(),
	    peerMap: {},
	    boot: function () {
		World.updateRoutes(this.subscriptions());
	    },
	    nym: function () { return $("#nym").val(); },
	    currentStatus: function () { return $("#status").val(); },
	    subscriptions: function () {
		return [sub("wake"),
			sub(["jQuery", "#send_chat", "click", __]),
			sub(["jQuery", "#nym", "change", __]),
			sub(["jQuery", "#status", "change", __]),
			sub(["jQuery", "#wsurl", "change", __]),
			pub(["broker", 0, chatEvent(this.nym(), this.currentStatus(), __, __)]),
			sub(["broker", 0, chatEvent(__, __, __, __)], 0, 1)];
	    },
	    handleEvent: function (e) {
		var self = this;
		switch (e.type) {
		case "routes":
		    updateNymList(e.routes);
		    break;
		case "message":
		    if (e.message === "wake") {
			wsconn.forceclose();
			return;
		    }
		    switch (e.message[0]) {
		    case "jQuery":
			switch (e.message[1])  {
			case "#send_chat":
			    var inp = $("#chat_input");
			    var utterance = inp.val();
			    inp.val("");
			    if (utterance) {
				World.send(["broker", 0, chatEvent(this.nym(),
								   this.currentStatus(),
								   utterance)]);
			    }
			    break;
			case "#nym":
			case "#status":
			    World.updateRoutes(this.subscriptions());
			    break;
			case "#wsurl":
			    wsconn.forceclose();
			    wsconn.wsurl = $("#wsurl").val();
			    break;
			default:
			    console.log("Got jquery event from as-yet-unhandled subscription",
					e.message[2], e.message[3]);
			}
			break;
		    case "broker":
			if (e.message[2][0] === "chatEvent") {
			    outputUtterance(chatEventNym(e.message[2]),
					    chatEventUtterance(e.message[2]));
			}
			break;
		    default:
			break;
		    }
		    break;
		}
	    }
	});
    });
    G.startStepping();
});
