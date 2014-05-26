// Generic Spy

function Spy(label, useJson, observationLevel) {
    this.label = label || "SPY";
    this.observationLevel = observationLevel || 10; // arbitrary. Should be Infinity. TODO
    this.useJson = useJson;
}

Spy.prototype.boot = function () {
    World.updateRoutes([sub(__, 0, this.observationLevel), pub(__, 0, this.observationLevel)]);
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
