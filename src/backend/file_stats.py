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
from threading  import Thread, Lock
import common
import load_dir
import config
try:
    import json
except ImportError:
    import simplejson as json
from HTMLParser import HTMLParser


def rename(filename):
    config.logging.info("Attempting to rename: " + filename)
    show_name, season, episode = common.is_tv_show(filename)
    if season != -1:
       config.logging.info("valid show found, getting proper name: " + filename)
       show_name = common.get_espisode_info(show_name,season,episode)
       show_name += filename[filename.rfind("."):]
       filename = common.name_wrapper(show_name)
       #a_job.filename = unicode(show_name, errors='ignore')
    else:
        config.logging.info("did not detect as show; checking if movie: " + filename)
        movie_name = common.is_movie(filename)
        if len(movie_name) > 0:
            config.logging.info("detected as movie: " + filename + " new name: " + movie_name)
            filename = common.name_wrapper(movie_name)
    return filename
    
if __name__ == '__main__':
    filename = sys.argv[1]
    print "Filename: " + rename(filename)