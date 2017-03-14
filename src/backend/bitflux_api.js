var express = require('express');
var app = express();
var bodyParser = require('body-parser')
var fs = require('fs');
var moment = require('moment');
var url = require("url");
var path = require("path");
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var Aria2 = require('aria2');
var request = require('request');
var cheerio = require('cheerio');
var path = require('path');

var xmlrpc = require('xmlrpc');
var Q = require('q');
var Promise = require("bluebird");
var divmod = require('divmod');
var sleep = require('sleep');
var diskspace = require('diskspace');
const exec = require('child_process').exec;
var rethinkdbOptions = {
    host: 'localhost',
    port: 28015,
    db: 'bitflux'
};
sleep.sleep(10);
var r = require('rethinkdbdash')(rethinkdbOptions);

var hiddenBaseDir = "/downloads";
var fileExtensions = ["mkv","mp3","avi","mp4","mpg","rar","zip","nfo","sfv"];

var aria2Options = {
  host: 'localhost',
  port: 6800,
  secure: false
}
var aria2Client = new Aria2(aria2Options);
aria2Client.getVersion([], function(err, res) {
  console.log(err || res);
});

var rutorrentUser = "bitflux";
var rutorrentPass = "~bitflux~";
//var bitfluxClient = xmlrpc.createClient({ host: 'localhost', port: 8001, path: '/bitfluxengine'})
var missingAraiIds = {};

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded())
/*
	var objList = [];
    var a_obj = {'filename':"job_filename",
                    'total_size' : "12345",
                    'queue_id' : 0,
                    'status' : "test",
                    'dl_speed' : "display_dl_speed",
                    'progress' : "progress",
                    'eta' : "eta",
                    'pid' : "aria2_pid",
                    'nid'  : "id",
                    'path' : "path",
                    'connections' : "connections"
                    }
    objList.push(a_obj)
    */

/*
 * Send back a 500 error
 */
function handleError(res) {
    return function(error) {
        res.send(500, {error: error.message});
    }
}

function createConnection(req, res, next) {
    r.connect(rethinkdbOptions).then(function(conn) {
        req._rdbConn = conn;
        next();
    }).error(handleError(res));
}

function closeConnection(req, res, next) {
    req._rdbConn.close();
    next();
}

function convert_bytes(bytes){
    bytes = parseFloat(bytes)
    if ( bytes >= 1099511627776 ){
        terabytes = bytes / 1099511627776
        size = terabytes.toFixed(2) + "TB"
    }else if ( bytes >= 1073741824 ){
        gigabytes = bytes / 1073741824
        size = gigabytes.toFixed(2) + "GB"
    }else if ( bytes >= 1048576 ){
        megabytes = bytes / 1048576
        size = megabytes.toFixed(2) + "MB"
    }else if ( bytes >= 1024 ){
        kilobytes = bytes / 1024
        size = kilobytes.toFixed(2) + "KB"
    }else{
        size = bytes.toFixed(2) + "B"
    }
    return size
}

function getETA(total, already_dled, speed){
    if ( parseFloat(already_dled) == 0 || parseFloat(speed) == 0 || parseFloat(total) == 0){
        //cannot calculate at this time
        return 0
    }
    var dif = parseFloat(total) - parseFloat(already_dled)
    var eta_seconds = dif / parseFloat(speed);
    var divmodResult = divmod(eta_seconds, 60);
    var m = parseInt(divmodResult[0]);
    var s = parseInt(divmodResult[1]);
    var eta = "";
    if ( m <=0 ){
        eta = s + "s";
    }else{    
        eta = m +"m " + s +"s";
    }
    if ( m > 60 ){
        var divmodResult = divmod(eta_seconds, 3600);
        h = parseInt(divmodResult[0]);
        m = parseInt(divmodResult[1]);
        eta = h +"h " + m +"m";
    }
    return eta
}
function saveAria2State(arai2Gid,callback){
	Q.all(aria2Client.tellStatus(arai2Gid, ['gid','downloadSpeed','completedLength','status','connections','totalLength'])).then(function(aria2Data){
	    	var updateData = {};
	    	updateData['status'] = aria2Data['status'];
	    	updateData['completedLength'] = aria2Data['completedLength'];
	    	updateData['totalLength'] = aria2Data['totalLength'];
	    	updateData['pid'] = aria2Data['gid'];
			Q.all(r.table("jobs").filter({"pid": aria2Data['gid']}).update(updateData).run()).then(function(ret){
 				console.log("Successfully updated job in db");
 				typeof callback === 'function' && callback();
 			}).catch(function(error){
 				console.log("An error occurred attempting to update job in db");
 				console.log(error);
 			});
	}).catch(function(error){
		console.log("An error occurred retrieving job");
		console.log(error);
	})
}

function renumberJobs(){
  r.table("jobs").orderBy('queue_id').run().then(function(jobs){
    for ( var i=0; i < jobs.length; i ++){
      r.table("jobs").get(jobs[i]['id']).update({"queue_id":i,"nid":i}).run();
    }
  })
}

function processQueue(){
	var maxConcurrentDownloads = 1;
	console.log("Checking job queue");
    	// check what other jobs are still running
    	r.table("jobs").filter({"status": "active"}).count().run().then(function(num){
    		// if less then the max Concurrent downloads, check if other queued jobs can be started
    		if ( num < maxConcurrentDownloads ){
    			// get list of queued jobs
    			r.table("jobs").filter({"status": "queued"}).orderBy('queue_id').run().then(function(qJobs){
    					// start the top most job that is queued
    					if (qJobs.length > 0){
    						console.log("Starting queued job");
    						startJob(qJobs[0]);
    					}else{
    						console.log("no jobs to queue")
    					}

    			});
    		}else{
    			console.log("Max concurrent jobs already running");
    		}
    	})

}

function startJob(job){
	if ( 'pid' in job && job['pid'] !== undefined && job['pid'] != -1 && !(job['pid'] in missingAraiIds) ){ // this was already added to arai2, so we want to do a 'unpause'
		aria2Client.unpause(job['pid'],function(err,res){
			if (err){
				console.log("An error occurred attempting to unpause job");
				console.log(err);
			}else{
				console.log("Job unpaused");
			}
		});
	}else{ // no valid aria2 id, to this is a new job
		var new_download_options = {"dir":job["local_basedir"],
	        "out":job["filename"],
	        "http-passwd":rutorrentPass,
	        "http-user":rutorrentUser,
	        "file-allocation":'none',
	        "continue":'true'
	        };
		console.log(job);
		aria2Client.addUri([job['url']],new_download_options,function(err,aria2_id){
			if ( err == null ){
				console.log("New arai2 job added");
		}else{
			console.log(err);
		}
			job['pid'] = aria2_id;
			Q.all(r.table("jobs").filter({"nid": job['nid']}).update(job).run()).then(function(ret){
				console.log("Successfully updated job in db");
			}).catch(function(error){
				console.log("An error occurred attempting to update job in db");
				console.log(error);
			});
		});
	}
}

function deleteIfExists(filepath){
	if (fs.existsSync(filepath)) {
	   fs.unlinkSync(filepath);
	}else{
		console.log("File " + filepath + " is not present on the disk");
	}
}

function addNewJob(new_job,dbConn,callback){
    Q.all(r.table('jobs').count().run()).then(function(numJobs){
        new_job['nid'] = numJobs;
        new_job['queue_id'] = numJobs;
        if ( new_job['status'].endsWith("Start") ){
			var new_download_options = {"dir":new_job["local_basedir"],
			        "out":new_job["filename"],
			        "http-passwd":rutorrentPass,
			        "http-user":rutorrentUser,
			        "file-allocation":'none',
			        "continue":'true'
			        };
     		aria2Client.addUri([new_job['url']],new_download_options,function(err,aria2_id){
     			/*if ( err == null ){
     				var returnlist = ['Added entry',new_job['filename']];
				}else{
					console.log(err);
					var returnlist = ['Failed to add entry',new_job['filename']];
				}*/
     			new_job['pid'] = aria2_id;
     			r.table("jobs").insert(new_job).run();
     		});
	    }
	    if ( new_job['status'].endsWith("Queue") ){
	       new_job['status'] = 'queued'
	       r.table("jobs").insert(new_job).run().then(function(ret){
	       		processQueue();
	       })
	    }
	    if ( new_job['status'].endsWith("Stop") ){
	        new_job['status'] = 'paused'
	        r.table("jobs").insert(new_job).run();
	    }
      typeof callback === 'function' && callback(null,"new job added");
    }).catch(function(error){
    	console.log("An error occurred retrieving the number of jobs");
    	console.log(error);
      typeof callback === 'function' && callback(error,"failed to add new job");
    })
}

var newDLRequest = function(urlStr,filename,withAutoRename,dl_dir,status,dbConn,callback){
	var parsed = url.parse(urlStr);
	if ( filename == null ){
		filename = querystring.unescape(path.basename(parsed.pathname));
	}
	console.log("filename:" + filename);
    var new_job = {};
    new_job['autorename'] = withAutoRename;
    new_job['filename'] = filename;;
    console.log("download dir; " + dl_dir);
    if ( dl_dir === undefined || dl_dir == ''){
        dl_dir = '/';
    }
    new_job['local_basedir'] = hiddenBaseDir + dl_dir
    new_job['status'] = status
    new_job['url'] = urlStr
    new_job['totalLength'] = 0 //temp
    new_job['tmpfilename'] = new_job["filename"] + ".aria2"
    if ( withAutoRename == true || withAutoRename == 'true' ){
		exec("python file_stats.py " + '"' + filename + '"',{"cwd":"/opt/bitflux/src/backend"}, function(error,stdout,stderr){
			filenameMatch = stdout.match(/^Filename: (.*)$/m);
			if ( filenameMatch != null){
				new_job['filename'] = filenameMatch[1];
				new_job['tmpfilename'] = new_job["filename"] + ".aria2"
			}else{
				console.log("could not rename show");
			}
			console.log(stdout);
			console.log(stderr);
			addNewJob(new_job,dbConn,function(error,msg){
				callback(msg);
			});
			//console.log(stdout.substring(loc,-1));
		})
    }else{
        addNewJob(new_job,dbConn,function(error,msg){
          callback(msg);
        });
    }
}
app.post('/',function(req,res){
	console.log(req.body);
	res.setHeader('Content-Type', 'application/json');
	if ( 'newDL' in req.body ){
		console.log("Start a new download");
        var the_action ="";  
        var status = "";  
        if ( 'start'in req.body){
            status = "New; Start";
            the_action = 'start';
        }else if ('queue' in req.body){
            the_action = 'queue';
            status = "New; Queue";
        }else if ('pause' in req.body){
            the_action = 'pause';
            status = "New; Stop";
        }
        var withAutoRename = req.body.withAutoRename;
        var urlStr = req.body.URL;
        console.log(urlStr);
        console.log(the_action);
    	var filename = null;
		var dl_dir = req.cookies['cwd'];
		console.log("download dir; " + dl_dir);
		if ( dl_dir === undefined || dl_dir == ''){
			dl_dir = '/';
		}
        if (urlStr.endsWith("/")){
            // download all items in directory
            console.log('Attempting to scan directory for files');
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
			var reqOptions = {url:urlStr,
							auth:{
									user:rutorrentUser,
									password:rutorrentPass
								}
							}
			request(reqOptions, function(err, resp, body){
				$ = cheerio.load(body);
				links = $('a'); // get all hyperlinks
				var promises = [];
				$(links).each(function(i, link){
					console.log("Lnk found in directory: "+ $(link).text());
					fileExtensions.forEach(function(fileExtension){
						if ($(link).text().endsWith("." + fileExtension)){
							var fullUrl = urlStr + $(link).attr('href');
							console.log("Matching link found in directory: " + fullUrl);
							var prom = new Promise(function(resolve,reject){
								newDLRequest(fullUrl,null,withAutoRename,dl_dir,status,req._rdbConn,function(msg){
									resolve(msg);
								});
							})
							promises.push(prom);
						}
					})
				})
				Q.all(promises).then(function(data){
					res.send(JSON.stringify(({'action_performed':'loaded directory','list':[] })));
				});
			});
        } else { // download single item
			if ( 'filename' in req.body){
				filename = req.body.filename;
			}
			newDLRequest(urlStr,filename,withAutoRename,dl_dir,status,req._rdbConn,function(msg){
				res.send(JSON.stringify(({'action_performed':msg,'list':[] })));
			});
	    }
  	}else if( 'Action' in req.body){
  		console.log("Do some action");
  		if ( 'stop' in req.body ){
  			var stopList = req.body.stop;
        if ( Number.isInteger(stopList) ){
          stopList = [stopList];
        }
  			for ( var i = 0; i < stopList.length; i++){
  				Q.all(r.table("jobs").filter({"nid": parseInt(stopList[i]) }).run()).then(function(jobs){
  						job = jobs[0];
  						if ( job['status'] == 'queued' || job['pid'] in missingAraiIds){
  							r.table("jobs").get(job['id']).update({'status':'paused'}).run();
  						} else {
		  					aria2Client.pause(job['pid'],function(err,res){
		  						if (err){
		  							console.log("An error occurred attempting to stop job");
		  							console.log(err);
		  						}else{
		  							console.log("Job stopped");
		  						}
		  					});
	  					}
  				}).catch(function(error){
  					console.log("An error occurred retrieving job from db");
  					console.log(error);
  				})
  			}
  		}
  		if ( 'delete' in req.body ){
  			var delList = req.body.delete;
        if ( Number.isInteger(delList) ){
          delList = [delList];
        }
  			for ( var i= 0 ; i < delList.length; i++ ){
  				Q.all(r.table("jobs").filter({"nid": parseInt(delList[i])}).run().then(function(jobs){
              console.log("Attempting to delete; " + jobs);
	  					job = jobs[0];
	  					if ( job !== undefined && 'pid' in job && job['pid'] !== undefined && job['pid'] != -1 && !(job['pid'] in missingAraiIds) ){ // this was already added to arai2, so we want to do a delete it from aria2 also
		  					var aria2Proms = [];
		  					if ( job['status'] != "complete"){
			  					var prom = aria2Client.remove(job['pid'],function(err,res){
			  						if (err){
			  							console.log("An error occurred attempting to remove job from arai2");
			  							console.log(err);
			  						}else{
			  							console.log("Job remove from arai2");						
			  						}
			  					});
			  					aria2Proms.push(prom);
		  					}
		  					Q.all(aria2Proms).then(function(){
		  						if ( job['status'] != 'paused' ){
			  						aria2Client.removeDownloadResult(job['pid'],function(err,res){
			  							if (err){
			  								console.log('An error occurred attempting to remove job metadata from arai2');
			  								console.log(err);
			  							}else{
			  								console.log('Job metadata removed from arai2');
					  						r.table("jobs").filter({"nid": job['nid']}).delete({returnChanges: true}).run().then(function(result){
					  							console.log("job deleted from DB");
							  					if ( 'DelWData' in req.body ){
						  							var filename = result['changes'][0]['old_val']['filename'];
						  							var tmpfilename = result['changes'][0]['old_val']['tmpfilename'];
						  							var local_basedir = result['changes'][0]['old_val']['local_basedir'];
							  						console.log("Attempting to delete downloaded files; ");
							  						console.log(local_basedir + "/" + filename);
							  						console.log(local_basedir + "/" + tmpfilename);
							  						deleteIfExists(local_basedir + "/" + filename);
							  						deleteIfExists(local_basedir + "/" + tmpfilename);
							  					}
											renumberJobs();
							  				}).catch(function(err){
				  								console.log("Failed to remove job from db");
				  								console.log(err);			  							
					  						});	  	
					  					}
			  						});
		  						}else{
			  						r.table("jobs").filter({"nid": job['nid']}).delete({returnChanges: true}).run().then(function(result){
			  							console.log("job deleted from DB");
					  					if ( 'DelWData' in req.body ){
				  							var filename = result['changes'][0]['old_val']['filename'];
				  							var tmpfilename = result['changes'][0]['old_val']['tmpfilename'];
				  							var local_basedir = result['changes'][0]['old_val']['local_basedir'];
					  						console.log("Attempting to delete downloaded files; ");
					  						console.log(local_basedir + "/" + filename);
					  						console.log(local_basedir + "/" + tmpfilename);
					  						deleteIfExists(local_basedir + "/" + filename);
					  						deleteIfExists(local_basedir + "/" + tmpfilename);
					  					}
                      renumberJobs();
					  				}).catch(function(err){
		  								console.log("Failed to remove job from db");
		  								console.log(err);			  							
			  						});	  			  							
		  						}
		  					})
	  					}else{ // job was not added to aria2 yet, so just remove it from the database
	  						r.table("jobs").filter({"nid": job['nid']}).delete({returnChanges: true}).run().then(function(result){
			  					console.log("job deleted from DB");
			  					if ( 'DelWData' in req.body ){
		  							var filename = result['changes'][0]['old_val']['filename'];
		  							var tmpfilename = result['changes'][0]['old_val']['tmpfilename'];
		  							var local_basedir = result['changes'][0]['old_val']['local_basedir'];
			  						console.log("Attempting to delete downloaded files; ");
			  						console.log(local_basedir + "/" + filename);
			  						console.log(local_basedir + "/" + tmpfilename);
			  						deleteIfExists(local_basedir + "/" + filename);
			  						deleteIfExists(local_basedir + "/" + tmpfilename);
			  					}
                  renumberJobs();
	  						}).catch(function(err){
  								console.log("Failed to remove job from db");
  								console.log(err);			  							
	  						});
	  					}
  				}).catch(function(error){
  					console.log("An error occurred getting job from DB to be deleted");
  					console.log(error);
  				})
  			) // end of Q

  				//r.table("jobs").filter({"nid": parseInt(delList[i])}).delete().run(req._rdbConn).then(function(cursor){
  				//	console.log(cursor)
  				//});
  				//	console.log(cursor);
  				//})
  				//aria2Client.remove()
  			}
  		}
  		if ( 'start' in req.body ){
  			console.log('Starting some jobs');
  			var startList = req.body.start;
        if ( Number.isInteger(startList) ){
          startList = [startList];
        }
   			for ( var i = 0; i < startList.length; i++){
   				console.log(startList[i]);
  				Q.all(r.table("jobs").filter({"nid": parseInt(startList[i]) }).run()).then(function(jobs){
  						job = jobs[0];		
	  					startJob(job);
  				}).catch(function(error){
  					console.log("An error occurred retrieving job from db");
  					console.log(error);
  				})
  			}
  		}
  		if ( 'queue' in req.body ){
  			console.log('queuing jobs');
  			var queueList = req.body.queue;
        if ( Number.isInteger(queueList) ){
          queueList = [queueList];
        }
  			for ( var i = 0; i < queueList.length; i++){
   				Q.all(r.table("jobs").filter({"nid": parseInt(queueList[i]) }).update({"status":"queued"}).run()).then(function(ret){
	  				console.log("Job queued");
	  				processQueue();
  				}).catch(function(error){
  					console.log("An error occurred updating job in db to queued");
  					console.log(error);
  				})		
  			}
  		}
      if ( 'cleanup' in req.body ){
        r.table("jobs").filter({"status": "complete" }).delete().run().then(function(ret){
        	renumberJobs();
        });
      }

	}else{
		console.log("do something else");
	}
	
	
})

app.get('/dlList/', function(req, res) {
	r.table('jobs').run().then(function(jobList) {
    		var promises = [];
    		for (var i = 0; i < jobList.length; i++) {
			    if ( 'pid' in jobList[i] && jobList[i]['pid'] != -1 && !(jobList[i]['pid'] in missingAraiIds) ){
			    	// create a promise with the return of the arai2 xmlrpc call and the job itself from the database
			    	promises.push(Promise.props(
			    		{ariaData: aria2Client.tellStatus(jobList[i]['pid'], ['gid','downloadSpeed','completedLength','status','connections','totalLength'])
			    		,jobData:jobList[i]})
			 		);
			    }else{
			    	// Create empty promise, just so that jobs that are in aria2 and jobs that have not yet been added follow the same code path
			    	var prom = new Promise(function(resolve,reject){
			    		resolve({});
			    	});
			    	promises.push({ariaData:{prom},jobData:jobList[i]});
			    }
			}
		    Q.all(promises).then(function(data){
		    	var combinedJobList = [];
		    	for (var i = 0; i < data.length; i++){
		    		Object.assign(data[i].jobData,data[i].ariaData)
		    		var job = data[i].jobData;
		    		// Add the download speed when returning the job data
		    		var downloadSpeed = job['downloadSpeed'];
		    		if (downloadSpeed === undefined){
		    			downloadSpeed = 0;
		    		}
		    		displaySpeed = convert_bytes(downloadSpeed);
		    		job['dl_speed'] = displaySpeed + "ps";

		    		// add the percent complete when returning the job data
		    		percent = parseFloat(job['completedLength']) / parseFloat(job['totalLength']);
                    progress = parseInt(percent * 100);
                    job['progress'] = progress;
                    job['total_size'] = convert_bytes(job['totalLength']);

                    job['eta'] = getETA(job['totalLength'], job['completedLength'], downloadSpeed);

		    		combinedJobList.push(job)
		    	}
		    	var startIndex = req.query.start;
		    	var limit = req.query.limit;
		    	var pagedCombinedJobList = combinedJobList.slice(startIndex,startIndex + limit);
		    	var dataObj = { 'count' : pagedCombinedJobList.length, 'total': combinedJobList.length,'downloads': pagedCombinedJobList }
		   		res.setHeader('Content-Type', 'application/json');
		   		res.send(JSON.stringify(dataObj));   	
		    }).catch(function(error){
		    	// tbd, this needs to be handled better
		    	console.log("An error occured retrieving job data");
		    	console.dir(error);
		    	if ( error.code == 1 ){ // this job is not in arai2 anymore
		    		var gid = error.message.substring(error.message.indexOf("GID ") + 4,error.message.indexOf(" is"));
		    		console.log("Adding gid " + gid + " to missing arai id list");
		    		missingAraiIds[gid] = "";
		    	}
		    	var dataObj = { 'count' : 0, 'total': 0,'downloads': [] }
		   		res.setHeader('Content-Type', 'application/json');
		   		res.send(JSON.stringify(dataObj));   	
		    });
	}).error(function(err){
		console.log(err);
	})
});

var getCWD = function(req,res){
	var cwd = "/";
	if (req.cookies['cwd'] !== undefined ){
		cwd = req.cookies['cwd'];
	}
	res.setHeader('Content-Type', 'application/json');
   	res.send(JSON.stringify(cwd));
}
app.get('/getCWD/',getCWD);
app.post('/getCWD/',getCWD);

app.get('/dirList/',function(req,res){
	var dir = "/"; // TBD change to default configurable directory

	if (req.query.currentDir !== undefined ){
		res.cookie("cwd" , req.query.currentDir);
		dir = req.query.currentDir;
	}
	var files = fs.readdirSync(hiddenBaseDir + dir);
	var objList = []
	for(var i in files) {
		var isDir = "N";
		var size = "-";
		var fileStats = fs.lstatSync(hiddenBaseDir + dir + files[i]);
		if (fileStats.isDirectory() || fileStats.isSymbolicLink() ){
			isDir = "Y";
		}else{
			size = convert_bytes(fileStats.size);
		}
	  	var a_obj =  {'entryName':files[i],
            'isDir' : isDir,
            'size' : size,
            'date' : moment(fileStats.mtime).format('LLL'),
            }
        objList.push(a_obj);
	}
	var dataObj = { 'count' : objList.length, 'total': objList.length,'dirList': objList }
   	res.setHeader('Content-Type', 'application/json');
   	res.send(JSON.stringify(dataObj));
});

var autoDLList = function(req,res){
	r.tableList().contains('autoDL').run().then(function(tableExists){
		if(tableExists){
			r.table('autoDL').wait({"timeout":5}).run().then(function(result){
				r.table('autoDL').run().then(function(autoDLs) {
		    			var objList = [];
		    			for (var i=0; i < autoDLs.length; i++ ){
		    				var entry = autoDLs[i];
		    				var latest_season = entry['season_to_start']
				            var latest_episode = entry['episode_to_start']
				            for ( var season in entry['download_log'] ){
				            	if ( season > latest_season ){
				            		latest_season = season
				            	}
				            }
				            if ( latest_season in entry['download_log'] ){
				            	for ( var episode in entry['download_log'][latest_season]){
				            		if ( episode > latest_episode ){
				            			latest_episode = episode
				            		}
				            	}
				            }
		    				var a_obj =  {'id':entry['id'],'proper_name':entry['proper_name'],'latest_season':latest_season,'latest_episode':latest_episode,'filenames_to_match':entry['filenames_to_match']}
		    				objList.push(a_obj);
		    			}
						var dataObj = { 'count' : objList.length, 'total': objList.length,'autoDLList': objList }
						res.setHeader('Content-Type', 'application/json');
						res.send(JSON.stringify(dataObj));			
		    	})
			})
		}else{
			var dataObj = { 'count' : 0, 'total': 0,'autoDLList': [] }
		   	res.setHeader('Content-Type', 'application/json');
		   	res.send(JSON.stringify(dataObj));
		}
	})

}
app.get('/autoDLList/',autoDLList);
app.post('/autoDLList/',autoDLList);

var autodlnew = function(req,res){
	var proper_name = req.body.autoDL_proper_name;
	var filenames_to_match = req.body.autoDL_match_names.split(',');
	var season_start = req.body.autoDL_season_start;
	var episode_start = req.body.autoDL_episode_start;
	var cwd = req.cookies['cwd'];
    var auto_dl_entry = {}
    auto_dl_entry['proper_name'] = proper_name
    auto_dl_entry['filenames_to_match'] = filenames_to_match
    auto_dl_entry['local_basedir'] = cwd
    auto_dl_entry['download_log'] = {}
    auto_dl_entry['season_to_start'] = season_start
    auto_dl_entry['episode_to_start'] = episode_start
    var id = req.body.autoDL_id;
    if (id != ''){
    	r.table("autoDL").get(id).update(auto_dl_entry).run();
    } else {
    	r.table("autoDL").insert(auto_dl_entry).run();
	}
   	res.setHeader('Content-Type', 'application/json');
   	res.send(JSON.stringify("{}"));
}
app.get('/autodlnew/',autodlnew);
app.post('/autodlnew/',autodlnew);

var autodldel = function(req,res){
    var id = req.body.id;
    r.table("autoDL").get(id).delete().run();
   	res.setHeader('Content-Type', 'application/json');
   	res.send(JSON.stringify("{}"));
}
app.get('/removeautodl/',autodldel);
app.post('/removeautodl/',autodldel);

var freeSpace = function(req,res){
    diskspace.check(hiddenBaseDir, function (err, total, free, status){
        var dataObj = { 'remaining' : convert_bytes(free)};
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(dataObj));
    });

}
app.get('/freespace/',freeSpace);
app.post('/freespace/',freeSpace);

var newdir = function(req,res){
    var dirName = req.body.mkDir;
    var fullDirName = hiddenBaseDir + req.cookies['cwd'] + dirName;
    console.log("Attempting to create directory; " + fullDirName);
    if (!fs.existsSync(fullDirName)){
        fs.mkdirSync(fullDirName);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify("Created new directory " + dirName));
    }else{
        console.log("directory already exists");
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify("Did not create new directory " + dirName));
    }
}
app.get('/newdir/',newdir);
app.post('/newdir',newdir);

var delentry = function(req,res){
    var dirName = req.body.rmEntry;
    if (dirName.length > 0){
	    var fullDirName = hiddenBaseDir + dirName;
	    if(fs.lstatSync(fullDirName).isDirectory()) {
			var deleteFolderRecursive = function(path) {
			  if( fs.existsSync(path) ) {
			    fs.readdirSync(path).forEach(function(file,index){
			      var curPath = path + "/" + file;
			      if(fs.lstatSync(curPath).isDirectory()) { // recurse
			        deleteFolderRecursive(curPath);
			      } else { // delete file
			        deleteIfExists(curPath);
			      }
			    });
			    fs.rmdirSync(path);
			  }
			};
			deleteFolderRecursive(fullDirName);
	    } else {
	        deleteIfExists(fullDirName);
	    }
	    res.setHeader('Content-Type', 'application/json');
	    res.send(JSON.stringify("Deleted " + dirName));
	} else {
	    res.setHeader('Content-Type', 'application/json');
	    res.send(JSON.stringify("Invalid path provided"));
	}

}
app.get('/rmEntry/',delentry);
app.post('/rmEntry/',delentry);


var renameEntry = function(req,res){
	var currentEntry = hiddenBaseDir + req.body.renameEntry;
	var newName = req.body.newName;
	var newEntry = path.dirname(currentEntry) + '/' + newName;
	console.log("Renaming " + currentEntry + " to " + newEntry);
	fs.rename(currentEntry,newEntry,function(error) {
	    res.setHeader('Content-Type', 'application/json');
	    if (error) {
	        console.log(error);
	        res.send(JSON.stringify("An error occurred attempting to rename"));
	    } else {
	    	res.send(JSON.stringify("Renamed successfully"));
	    }
	});

}
app.get('/renameEntry/',renameEntry);
app.post('/renameEntry/',renameEntry);

/*
 * Create tables/indexes then start express
 */
 var startupCount = 0;
 var maxStartupAttempts = 30;
 function initDB(){
	    	r.dbList().contains('bitflux').run().then(function(dbExists){
		    	if (!dbExists){
		    		console.log("Creating init db and table");
			        r.dbCreate('bitflux').run().then(function(result) {
			            r.tableCreate('jobs').run().then(function(result){
			            	r.table('jobs').wait().run().then(function(result){
					            console.log("Table and index are available, starting express...");
					            startExpress();
			            	})
	            	
			            })
			        })
		    	}else{
	            	r.table('jobs').wait().run().then(function(result){
			            console.log("Table and index are available, starting express...");
			            startExpress();
	            	})
		    	}
		    })
}

function startExpress() {
	server = app.listen(3001);
	console.log('Listening on port 3001...');
}

function setupArai2Callbacks(){
    aria2Client.open(function () {
      console.log('Arai2 websocket opened');
    });
	aria2Client.onDownloadStart = function(data){
		console.log("Download started");
		console.log(data['gid']);
		saveAria2State(data['gid']);

	}
	aria2Client.onDownloadPause = function(data){
		console.log("Download paused");
		console.log(data['gid']);
		saveAria2State(data['gid'],processQueue);
	}
	aria2Client.onDownloadStop = function(data){
		console.log("Download stopped");
		console.log(data['gid']);
		saveAria2State(data['gid'],processQueue);
	}
	aria2Client.onDownloadComplete = function(data){
		console.log("Download completed");
		console.log(data['gid']);
		saveAria2State(data['gid'],processQueue);
	}
	aria2Client.onDownloadError = function(data){
		console.log("Download encountered an error");
		console.log(data['gid']);
		saveAria2State(data['gid'],processQueue);
	}
}
initDB();
setupArai2Callbacks();

process.on( "SIGINT", function() {
	console.log('CLOSING [SIGINT]');
	server.close(function(){
		aria2Client.close(function(){
			console.log("Closing aria2 websocket");
			process.exit(0);
		})
	})
} );