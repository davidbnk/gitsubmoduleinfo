var Glob = require('glob');
var Path = require('path');
var Promise = require('bluebird');
var ChildProcessPromise = require('child-process-promise').exec;
var Colors = require('colors/safe');

console.log('-> Locating git repositories in', process.cwd(), '...');
var filePaths = Glob.sync(Path.resolve(process.cwd()) + '/**/.git').map(s => s.replace('/.git', ''));

console.log('Found', filePaths.length, 'git repositories');

Promise.mapSeries(filePaths, function(filePath) {

	filePath = Path.resolve(__dirname, filePath);
	console.log('##################################################################################################');
	console.log('-> Verifying repository', filePath);
	
	console.log('-> Fetching all branches ...');
	
	return Exec('git fetch --all', { cwd: filePath }).then(function(stdout, stderr) {
	
		return Exec('git branch -r', { cwd: filePath });
	}).then(function(stdout, stderr) {

		var branches = stdout
			.split('\n')
			.map(s => s.trim())
			.filter(s => s !== 'origin/HEAD -> origin/master')
			.filter(Boolean)
			.map(s => s.split('/')[1]);

		console.log('-> Found remote branches:');
		console.log(branches.join('\n'));
		
		var currentBranch = '';
		
		return Exec('git rev-parse HEAD', { cwd: filePath }).then(function(stdout, stderr) {

			var currentCommit = stdout;
			return Exec('git branch --contains ' + currentCommit, { cwd: filePath });

		}).then(function(stdout, stderr) {
			
			var candidateBranches = stdout
				.split(/\r\n|\r|\n/g)
				.map(s => s.trim())
				.sort(s => s.indexOf('*') !== -1 || s === 'master' ? 1 : -1)
				.map(s => s.replace ('* ', ''))
				.filter(Boolean)
				.filter(c => c.indexOf('HEAD detached at') === -1)
				.filter(c => c !== 'master');
			
			if (candidateBranches.length === 0) {
				candidateBranches.push('master');
			}
			
			currentBranch = candidateBranches[0];
			
			console.log('-> Your current branch is:');
			console.log(Colors.bgCyan(currentBranch));
			
			return Promise.mapSeries(branches, function(branch) {

				console.log('-> Checking branch ' + branch + ':');
				
				return Exec('git rev-list HEAD...origin/' + branch + ' --count', { cwd: filePath }).then(function(stdout, stderr) {
					
					var behind = parseInt(stdout);
					if (behind > 0) {
						if (branch === currentBranch) {
							console.warn(Colors.red('Your local branch', branch, 'is behind remote for', behind, 'commits'));
						} else {
							console.log(Colors.yellow('Your local branch', branch, 'is behind remote for', behind, 'commits'));
						}
					} else {
						console.log('Your local branch', branch, 'is up to date with remote');
					}

					if (branch === 'master') {
						return Promise.resolve();
					}
					
					return Exec('git rev-list --left-right --count origin/master...origin/' + branch, { cwd: filePath }).then(function(stdout, stderr) {

						var numbers = stdout.split(/[ \n\t]/g).filter(Boolean);
						var behind = parseInt(numbers[0]);
						var ahead = parseInt(numbers[1]);
						if (behind > 0) {
							if (branch === currentBranch) {
								console.warn(Colors.red('Remote branch', branch, 'is behind remote master for', behind, 'commits'));
							} else {
								console.log(Colors.yellow('Remote branch', branch, 'is behind remote master for', behind, 'commits'));
							}
						} else {
							console.log('Remote branch', branch, 'is ahead of master for', ahead, 'commits');
						}
					});
				});
			});
		});
	}).catch(function(err) {
		
		console.error('ERROR:', err);
	});
});

function Exec() {

	return ChildProcessPromise.apply(this, arguments).then(function (result) {
        var stderr = result.stderr;
		var stdout = result.stdout;
		return Promise.resolve(stdout, stderr);
    });
}
