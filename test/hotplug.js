//// hot-plug lifecycle: timers and listeners must not leak after close/disconnect

var assert = require('assert');
var path = require('path');
var child_process = require('child_process');

function run_child(mode, done) {
  var file = path.join(__dirname, 'hotplug_child.js');
  child_process.execFile(process.execPath, [file, mode], { timeout: 15000 }, function(err) {
    if (err) {
      assert.fail('child process did not exit cleanly (' + mode + '): ' + (err.killed ? 'killed by timeout - leaked timer or listener' : err.message));
    }
    done();
  });
}

describe('Hot-plug cleanup', function() {
  this.timeout(20000);
  it('process exits after JZZ().close() with active watcher', function(done) {
    run_child('close', done);
  });
  it('process exits after watcher disconnect', function(done) {
    run_child('disconnect', done);
  });
});
