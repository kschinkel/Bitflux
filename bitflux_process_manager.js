const spawn = require('child_process').spawn;

var xmlrpc_secret = 'bitflux';

//list of services to run in the container
var services = [
	{
		name: 'nginx',
		command: 'nginx',
		args: ['-g','daemon off;']
	},{
		name: 'bitflux api',
		command: 'gosu',
		args: [   process.env.MOUNT_UID + ":" + process.env.MOUNT_GID, // gosu args
                   "node",				// cmd for gosu to execute
                   '/opt/bitflux/src/backend/bitflux_api.js'],
	},{
		name: 'bitflux autodl',
		command: 'gosu',
		args: [ 	process.env.MOUNT_UID + ":" + process.env.MOUNT_GID, // gosu args
                   "python",				// cmd for gosu to execute
                   'autoDL.py'],
        options: {"cwd":"/opt/bitflux/src/backend/"}
	},{
		name: 'rethinkdb',
		command: 'rethinkdb',
		args: ['--bind', 'all']
	},{
		name: 'aria2',
		command: 'gosu',
		args: [   process.env.MOUNT_UID + ":" + process.env.MOUNT_GID, // gosu args
                   "aria2c",				// cmd for gosu to execute
		           "--max-tries=0",
		           "--rpc-allow-origin-all=true",
                   "--enable-rpc=true",
                   "--check-certificate=false",
                   "--always-resume=false",
                   "--max-connection-per-server=10",
                   "--split=1",
                   "--split=10",
                   "--stream-piece-selector=inorder",
                   "--max-concurrent-downloads=10",
                   "--min-split-size=10M"
                   ]
	}
];

//list of running processes
var serviceProcesses = [];

services.forEach(function(service) {
	console.log(service.command, service.args);
	var serviceProcess = spawn(service.command, service.args,service.options);
	serviceProcesses.push(serviceProcess);

	serviceProcess.stdout.on('data', (data) => {
		console.log(service.name + ": " + data);
	});

	serviceProcess.stderr.on('data', (data) => {
		console.log(service.name + ": " + data);
	});

	serviceProcess.on('close', (code) => {
		console.log(service.name + ": exit - " + code);
		killAllProcesses();
		process.exit(0); //exit process to kill container
	});
});

 //sends SIGTERM to all running processes
function killAllProcesses() {
	serviceProcesses.forEach(function(serviceProcess) {
		serviceProcess.kill();
	});
}


process.on( "SIGINT", function() {
	console.log('CLOSING [SIGINT]');
	killAllProcesses();
} );