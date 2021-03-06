var expect = require('expect.js');

var Minimart = require('../src/main.js');

var World = Minimart.World;
var Actor = Minimart.Actor;
var sub = Minimart.sub;
var pub = Minimart.pub;
var __ = Minimart.__;
var _$ = Minimart._$;

function configurationTrace(bootConfiguration) {
  var eventLog = [];
  function trace(item) {
    eventLog.push(item);
  }

  var G = new Minimart.Ground(function () {
    bootConfiguration(trace);
  });

  while (G.step()) {
    // do nothing until G becomes inert
  }

  return eventLog;
}

function checkTrace(bootConfiguration, expected) {
  expect(configurationTrace(bootConfiguration)).to.eql(expected);
}

describe("configurationTrace", function() {
  describe("with an inert configuration", function () {
    it("should yield an empty trace", function () {
      checkTrace(function (trace) {}, []);
    });
  });

  describe("with a single trace in an inert configuration", function () {
    it("should yield that trace", function () {
      checkTrace(function (trace) { trace(1) }, [1]);
    });
  });

  describe("with some traced communication", function () {
    it("should yield an appropriate trace", function () {
      checkTrace(function (trace) {
	World.spawn({
	  boot: function () { return [sub(__)] },
	  handleEvent: function (e) {
	    trace(e);
	  }
	});
	World.send(123);
	World.send(234);
      }, [Minimart.updateRoutes([]),
	  Minimart.sendMessage(123),
	  Minimart.sendMessage(234)]);
    });
  });
});

describe("nonempty initial routes", function () {
  it("should be immediately signalled to the process", function () {
    // Specifically, no Minimart.updateRoutes([]) first.
    checkTrace(function (trace) {
      World.spawn({
	boot: function () { return [pub(["A", __])] },
	handleEvent: function (e) {
	  World.spawn({
	    boot: function () { return [sub(["A", __], 0, 1)] },
	    handleEvent: trace
	  });
	}
      });
    }, [Minimart.updateRoutes([pub(["A", __]).label(1)])]);
  });
});

describe("actor with nonempty initial routes", function () {
  it("shouldn't see initial empty conversational context", function () {
    checkTrace(function (trace) {
      World.spawn({
	boot: function () { return [pub(["A", __])] },
	handleEvent: function (e) {
	  World.spawn(new Actor(function () {
	    Actor.observeAdvertisers(
	      function () { return ["A", __] },
	      { presence: "isPresent" },
	      function () {
		trace(["isPresent", this.isPresent]);
	      });
	  }));
	}
      });
    }, [["isPresent", true]]);
  });
});
