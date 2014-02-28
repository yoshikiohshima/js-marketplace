// JQuery event driver

function spawnJQueryDriver(baseSelector, metaLevel) {
    metaLevel = metaLevel || 0;
    var d = new DemandMatcher(["jQuery", __, __, __], metaLevel);
    d.onDemandIncrease = function (r) {
	var selector = r.pattern[1];
	var eventName = r.pattern[2];
	World.spawn(new JQueryEventRouter(baseSelector, selector, eventName, metaLevel),
		    [pub(["jQuery", selector, eventName, __], metaLevel),
		     pub(["jQuery", selector, eventName, __], metaLevel, 1)]);
    };
    World.spawn(d);
}

function JQueryEventRouter(baseSelector, selector, eventName, metaLevel) {
    var self = this;
    this.baseSelector = baseSelector || null;
    this.selector = selector;
    this.eventName = eventName;
    this.metaLevel = metaLevel || 0;
    this.preventDefault = (this.eventName.charAt(0) !== "+");
    this.handler =
	World.wrap(function (e) {
	    World.send(["jQuery", self.selector, self.eventName, e], self.metaLevel);
	    if (self.preventDefault) e.preventDefault();
	    return !self.preventDefault;
	});
    this.computeNodes().on(this.preventDefault ? this.eventName : this.eventName.substring(1),
			   this.handler);
}

JQueryEventRouter.prototype.handleEvent = function (e) {
    if (e.type === "routes" && e.routes.length === 0) {
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