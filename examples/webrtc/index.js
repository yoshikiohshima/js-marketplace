///////////////////////////////////////////////////////////////////////////

function chatEvent(nym, status, utterance, stamp) {
  return ["chatEvent", nym, status, utterance, stamp || +(new Date())];
}

function halfConnection(fromNym, toNym, sdp) {
  return ["route", fromNym, toNym, sdp];
}

function remoteValue(x, metaLevel) {
  return ["broker", metaLevel || 0, x];
}

///////////////////////////////////////////////////////////////////////////

var G;
$(document).ready(function () {
  var World = Minimart.World;
  var Actor = Minimart.Actor;
  var sub = Minimart.sub;
  var pub = Minimart.pub;
  var __ = Minimart.__;
  var _$ = Minimart._$;

  var rtcConfig = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

  G = new Minimart.Ground(function () {
    var wsconn = new Minimart.WebSocket.WebSocketConnection("broker", "ws://server.minimart.leastfixedpoint.com:8000/", true);
    World.spawn(wsconn);

    var localNym = "user-" + Math.floor(Math.random() * 1048576);
    console.log("localNym", localNym);

    //
    // Advertise our presence.
    //

    World.spawn(new Actor(function () {
      Actor.advertise(
	function () { return remoteValue(chatEvent(localNym, "", __, __)) });
    }));

    //
    // DemandMatcher waits for people to appear, and when they do, offers an SDP to them.
    //

    var dm = new Minimart.DemandMatcher(remoteValue(chatEvent(_$, __, __, __)), 0, {
      supplyProjection: remoteValue(halfConnection(__, _$, __))
    });
    dm.onDemandIncrease = function (captures) {
      spawnRoute(captures[0]);
    };
    World.spawn(dm);

    //
    // spawnRoute spawns an actor responsible for managing an
    // RTCPeerConnection to a specific remote peer.
    //

    function spawnRoute(remoteNym) {
      console.log("spawnRoute", remoteNym);
      var RTCPeerConnection = (window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);
      var RTCSessionDescription = (window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription);

      World.spawn(new Actor(function () {
	var self = this;

	self.peerSeen = false;

	if (localNym !== remoteNym) {
	  self.pc = new RTCPeerConnection(rtcConfig);
	  console.log(self.pc);
	  self.ch = self.pc.createDataChannel('x'); // TODO -- label

    	  var errback = World.wrap(function (err) { // TODO - make a standard World utility?
    	    throw err;
    	  });

	  setTimeout(World.wrap(function () {
	    self.pc.onicecandidate = World.wrap(function (e) {
    	      self.localSdp = self.pc.localDescription.sdp;
    	      self.updateRoutes();
	    });

    	    self.pc.createOffer(function (offer) {
	      console.log("HERE", self.pc.setLocalDescription);
	      console.log("BLAH", new RTCSessionDescription(offer));
    	      self.pc.setLocalDescription(new RTCSessionDescription(offer), function () {}, errback);
    	    }, errback);
	  }), 0);

	  Actor.advertise(
    	    function () { return remoteValue(halfConnection(localNym, remoteNym, self.localSdp)) },
    	    { when: function () { return self.localSdp } });

	  Actor.observeAdvertisers(
    	    function () { return remoteValue(halfConnection(remoteNym, localNym, _$("sdp"))) },
    	    { singleton: "remoteSdp" },
    	    function () {
	      if (self.localSdp && self.remoteSdp) {
		var params = {
		  type: "offer",
		  sdp: self.remoteSdp.sdp
		};
		console.log("Local SDP is", self.localSdp);
		console.log("Remote SDP is", params);
		self.pc.setRemoteDescription(new RTCSessionDescription(params), function () {}, errback);
	      }
    	    });
	}

	Actor.observeAdvertisers(
	  function () { return remoteValue(chatEvent(remoteNym, __, __, __)) },
	  { presence: "peerPresent" },
	  function () {
	    self.peerSeen = self.peerSeen || self.peerPresent;
	    if (self.peerSeen && !self.peerPresent) {
	      console.log("Peer went missing", remoteNym);
	      World.exit();
	    }
	  });
      }));
    }




    // World.spawn(new Actor(function () {
    //   var self = this;
    //   self.pc = new (window.mozRTCPeerConnection || window.webkitRTCPeerConnection)(rtcConfig);
    //   x = self.pc;
    //   self.ch = self.pc.createDataChannel('x'); // TODO -- label

    //   self.pc.onicecandidate = World.wrap(function (e) {
    // 	self.offerSdp = self.pc.localDescription.sdp;
    // 	console.log("onicecandidate", self.offerSdp);
    // 	self.updateRoutes();
    //   });

    //   Actor.observeAdvertisers(
    // 	function () { return ["broker_state", _$("state")] },
    // 	{ name: "broker_states",
    // 	  set: function (o) { return o.state; } },
    // 	function () {
    // 	  if (self.broker_states[0] === "connected" && !self.pc.localDescription) {
    // 	    var errback = World.wrap(function (err) {
    // 	      throw new Error(err);
    // 	    });
    // 	    self.pc.createOffer(function (offer) {
    // 	      self.pc.setLocalDescription(offer, function () {}, errback);
    // 	    }, errback);
    // 	  }
    // 	});

    //   Actor.advertise(
    // 	function () { return ["broker", 0, ["offerSdp", self.offerSdp]] },
    // 	{ when: function () { return self.offerSdp } });

    //   Actor.observeAdvertisers(
    // 	function () { return ["broker", 0, ["offerSdp", _$("offerSdp")]] },
    // 	{ name: "offers",
    // 	  set: function (o) { return o.offerSdp; } },
    // 	function () {
    // 	  var elt = document.getElementById('output');
    // 	  elt.innerHTML = '';
    // 	  for (var i = 0; i < self.offers.length; i++) {
    // 	    // console.log(self.offers[i]);
    // 	    elt.appendChild(document.createTextNode('\n' + self.offers[i]));
    // 	  }
    // 	});
    // }));
  });
  G.startStepping();
});
