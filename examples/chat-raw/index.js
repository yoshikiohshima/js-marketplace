var Route = Minimart.Route;
var World = Minimart.World;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;
var _$ = Minimart._$;

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

function updateNymList(g) {
    var statuses = {};
    var nymProj = ["broker", 0, ["chatEvent", _$, _$, __, __]];
    var matchedNyms = Route.matcherKeys(g.project(Route.compileProjection(nymProj), true, 0, 0));
    for (var i = 0; i < matchedNyms.length; i++) {
	statuses[matchedNyms[i][0]] = matchedNyms[i][1];
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

    G = new Minimart.Ground(function () {
	console.log('starting ground boot');
	// World.spawn(new Spy());
	Minimart.JQuery.spawnJQueryDriver();
	Minimart.DOM.spawnDOMDriver();
	Minimart.RoutingTableWidget.spawnRoutingTableWidget("#spy-holder", "spy");

	World.spawn(new Minimart.WakeDetector());
	var wsconn = new Minimart.WebSocket.WebSocketConnection("broker", $("#wsurl").val(), true);
	World.spawn(wsconn);
	World.spawn({
	    // Monitor connection, notifying connectivity changes
	    state: "crashed", // start with this to avoid spurious initial message print
	    boot: function () {
	        return [sub(["broker_state", __], 0, 1)];
	    },
	    handleEvent: function (e) {
		if (e.type === "routes") {
		    var states =
			Route.matcherKeys(e.gestalt.project(Route.compileProjection([__, _$]),
							    true, 0, 0));
		    var newState = states.length > 0 ? states[0][0] : "crashed";
		    if (this.state != newState) {
			outputState(newState);
			this.state = newState;
		    }
		}
	    }
	});
	World.spawn({
	    // Actual chat functionality
	    boot: function () {
		return this.subscriptions();
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
		    updateNymList(e.gestalt);
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
