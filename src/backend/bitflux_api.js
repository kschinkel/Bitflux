var express = require('express');
var app = express();
var fs = require('fs');
var moment = require('moment');
var cookieParser = require('cookie-parser');

app.use(cookieParser());

app.get('/dlList/', function(req, res) {
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
    var dataObj = { 'count' : objList.length, 'total': objList.length,'downloads': objList }
   	res.setHeader('Content-Type', 'application/json');
   	res.send(JSON.stringify(dataObj));
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
	var files = fs.readdirSync(dir);
	var objList = []
	for(var i in files) {
		var isDir = "N";
		var size = "-";
		var fileStats = fs.lstatSync(dir + files[i]);
		if (fileStats.isDirectory() || fileStats.isSymbolicLink() ){
			isDir = "Y";
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


app.listen(3001);
console.log('Listening on port 3001...');