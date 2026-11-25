//// child process fixture for test/hotplug.js - not a mocha test
//// starts the engine watcher (which arms a timer) and then closes it;
//// if timers or listeners leak, the process hangs and the parent test fails

if (require.main === module) {
  var JZZ = require('..');
  var mode = process.argv[2];
  JZZ().and(function() {
    JZZ().onChange(function() {});
    setTimeout(function() {
      if (mode == 'disconnect') JZZ().onChange().disconnect();
      else JZZ().close();
    }, 300);
  });
}
