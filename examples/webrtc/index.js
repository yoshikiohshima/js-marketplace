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

    World.spawn(new Actor(function () {
      var self = this;
      self.pc = new (window.mozRTCPeerConnection || window.webkitRTCPeerConnection)(rtcConfig);
      x = self.pc;
      self.ch = self.pc.createDataChannel('x'); // TODO -- label

      self.pc.onicecandidate = World.wrap(function (e) {
	self.offerSdp = self.pc.localDescription.sdp;
	console.log("onicecandidate", self.offerSdp);
	self.updateRoutes();
      });

      Actor.observeAdvertisers(
	function () { return ["broker_state", _$("state")] },
	{ name: "broker_states",
	  set: function (o) { return o.state; } },
	function () {
	  if (self.broker_states[0] === "connected" && !self.pc.localDescription) {
	    var errback = World.wrap(function (err) {
	      throw new Error(err);
	    });
	    self.pc.createOffer(function (offer) {
	      self.pc.setLocalDescription(offer, function () {}, errback);
	    }, errback);
	  }
	});

      Actor.advertise(
	function () { return ["broker", 0, ["offerSdp", self.offerSdp]] },
	{ when: function () { return self.offerSdp } });

      Actor.observeAdvertisers(
	function () { return ["broker", 0, ["offerSdp", _$("offerSdp")]] },
	{ name: "offers",
	  set: function (o) { return o.offerSdp; } },
	function () {
	  var elt = document.getElementById('output');
	  elt.innerHTML = '';
	  for (var i = 0; i < self.offers.length; i++) {
	    // console.log(self.offers[i]);
	    elt.appendChild(document.createTextNode('\n' + self.offers[i]));
	  }
	});
    }));
  });
  G.startStepping();
});
