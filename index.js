#!/usr/bin/env node

var Glob = require('glob');
var Path = require('path');
var Promise = require('bluebird');
var ChildProcessPromise = require('child-process-promise').exec;
var Colors = require('colors/safe');

console.log('-> Locating git repositories in', process.cwd(), '...');
var filePaths = Glob.sync(Path.resolve(process.cwd()) + '/**/.git').map((s) => s.replace('/.git', ''));

console.log('Found', filePaths.length, 'git repositories');

Promise.mapSeries(filePaths, function (filePath) {

	filePath = Path.resolve(__dirname, filePath);
	console.log('##################################################################################################');
	console.log('-> Verifying repository', filePath);

	var currentBranchPromise = Promise.try(function () {

		console.log('-> Checking current branch ...');

		return Exec(
			'git show -s --pretty=%d HEAD', {
				cwd: filePath
			}
		);
	}).then(function (stdout, stderr) {

		var candidateBranches = stdout
			.split(',')
			.map((s) => s.trim())
			.map((s) => s.replace(/\)|\(/g, ''))
			.map((s) => s.replace('HEAD -> ', ''))
			.filter((s) => s !== 'HEAD')
			.map((s) => {

				return s.split('/').length > 1 ? s.split('/')[1] : s;
			});

		if (candidateBranches.length === 0) {
			// Could not detect with first command
			// Attempt a second command
			return Exec(
			'git branch --contains HEAD', {
				cwd: filePath
			}).then(function (stdout2, stderr2) {

				candidateBranches = stdout2
					.split(/\r\n|\r|\n/g)
					.map((s) => s.trim())
					.sort(function (a, b) {

						if (a.indexOf('*') !== -1) {
							return -1;
						}
						if (b.indexOf('*') !== -1) {
							return 1;
						}
						if (a === 'master') {
							return -1;
						}
						if (b === 'master') {
							return 1;
						}
						return a > b ? 1 : -1;
					})
					.map((s) => s.replace('* ', ''))
					.filter(Boolean)
					.filter((c) => c.indexOf('HEAD detached at') === -1);

				if (candidateBranches.length > 0) {
					return Promise.resolve(candidateBranches[0]);
				}

				return Promise.resolve(null);
			});
		}

		return Promise.resolve(candidateBranches[0]);
	}).then(function (currentBranch) {

		if (currentBranch === null) {
			throw Error('Could not determine current branch');
		}

		console.log('-> Your current local branch is:');
		console.log(Colors.bgCyan(currentBranch));

		return Promise.resolve(currentBranch);
	});

	var branchesPromise = currentBranchPromise.then(function (currentBranch) {

		console.log('-> Fetching all remote branches ...');

		return Exec(
			'git fetch --all', {
				cwd: filePath
			}
		).then(function (stdout, stderr) {

			return Exec('git branch -r', { cwd: filePath });
		}).then(function (stdout, stderr) {

			var branches = stdout
			.split('\n')
			.map((s) => s.trim())
			.filter((s) => s !== 'origin/HEAD -> origin/master')
			.filter(Boolean)
			.map((s) => s.split('/')[1]);

			console.log('-> Found remote branches:');
			branches.forEach(function (branch) {

				if (branch !== currentBranch) {
					console.log(Colors.bgYellow('- ' + branch));
				} else {
					console.log(Colors.bgCyan('* ' + branch));
				}
			});

			return Promise.resolve(branches);
		});
	});

	return Promise.all(
		[branchesPromise, currentBranchPromise]
	).spread(function (branches, currentBranch) {

		return Promise.mapSeries(branches, function (branch) {

			console.log('-> Checking branch ' + branch + ':');

			var checkBehindRemotePromise = Exec(
				'git rev-list HEAD...origin/' + branch + ' --count', {
					cwd: filePath
				}
			).then(function (stdout, stderr) {

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
			});

			var checkBehindMasterPromise = Promise.try(function () {

				if (branch === 'master') {
					return Promise.resolve();
				}

				return Exec(
					'git rev-list --left-right --count origin/master...origin/' + branch, {
						cwd: filePath
					}
				).then(function (stdout, stderr) {

					var numbers = stdout.split(/[ \n\t]/g).filter(Boolean);
					var behindMaster = parseInt(numbers[0]);
					var ahead = parseInt(numbers[1]);
					if (behindMaster > 0) {
						if (branch === currentBranch) {
							console.warn(Colors.red('Remote branch', branch, 'is behind remote master for', behindMaster, 'commits'));
						} else {
							console.log(Colors.yellow('Remote branch', branch, 'is behind remote master for', behindMaster, 'commits'));
						}
					} else {
						console.log('Remote branch', branch, 'is ahead of master for', ahead, 'commits');
					}
				});
			});

			return Promise.all([checkBehindRemotePromise, checkBehindMasterPromise]);
		});
	}).catch(function (err) {

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
