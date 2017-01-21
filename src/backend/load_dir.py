import subprocess 
import time
import datetime
import os
import sys
import ctypes
import time
import signal
from datetime import timedelta
import re
import threading,thread
import httplib
import urllib
import xmlrpclib
import random, string
import traceback
import common
import config
try:
    import json
except ImportError:
    import simplejson as json
from HTMLParser import HTMLParser
    
def loadDirectory(full_url, local_directory, status, autorename, engine_xmlrpc_url):
    engine = xmlrpclib.Server(engine_xmlrpc_url)
    config.logging.info('loading dir, autorename field is: ' + str(autorename))
    myparser  = common.MyHTMLParser()
    myparser.set_parent_info(full_url, local_directory, status, autorename)
    
    #continue to parse directory for entries
    m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", full_url)
    mvals = m.groupdict()
    if mvals['port'] is None:
        mvals['port'] = 80
        if mvals['type'] == 'https':
            mvals['port'] = 443
    basic_auth = config.USERNAME + ":"+config.PASSWORD
    encoded = basic_auth.encode("base64")[:-1]
    headers = {"Authorization":"Basic %s" % encoded}
    params = ""
    try:
        if mvals['type'] == 'https':
            conn = httplib.HTTPSConnection(mvals['host'],mvals['port'], timeout=10)
        else:
            conn = httplib.HTTPConnection(mvals['host'],mvals['port'], timeout=10)
        conn.request('GET',mvals['path'],params,headers);
        responce = conn.getresponse()
        fullhtmlpage = responce.read()
        conn.close()
        myparser.feed(fullhtmlpage)
    except Exception,e:
        config.logging.info("Failed to load directory: " + full_url)
        return

    for entry in myparser.set_links_with_dir(full_url):
        OUT_list = entry.split('/')
        filename = OUT_list.pop()
        filename = urllib.unquote(filename)
        config.logging.info("Entry in directory found:" + filename)
        
        try:
            responce, filename, size = common.getEntryInfo(entry)
        except:
            size = -1
        out_list = mvals['path'].split('/')
        dir = out_list.pop()
        dir = out_list.pop()
        dir = urllib.unquote(dir)


        entry = urllib.unquote(entry)
        m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", entry)
        mvals = m.groupdict()
        full_dl_path = mvals['type']+'://' + mvals['host'] + urllib.quote(mvals['path'] )
        
        #out = profile.dl_dir+filename
        new_job = {}
        new_job['status'] = status
        new_job['url'] = full_dl_path
        new_job['local_basedir'] = local_directory
        new_job['filename'] = common.name_wrapper(filename)
        new_job['autorename'] = autorename
        engine.newjob(new_job)
    myparser.close()
    
