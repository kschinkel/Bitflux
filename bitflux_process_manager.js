const spawn = require('child_process').spawn;

var xmlrpc_secret = 'bitflux';

//list of services to run in the container
var services = [
	{
		name: 'nginx',
		command: 'nginx',
		args: ['-g','daemon off;']
	}, {
		name: 'rethinkdb',
		command: 'rethinkdb',
		args: ['--bind', 'all']
	},{
		name: 'aria2',
		command: 'aria2c',
		args: [   '--max-tries=0',
                   "--enable-rpc=true",
                   "--rpc-secret=" + xmlrpc_secret,
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
	var serviceProcess = spawn(service.command, service.args);
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