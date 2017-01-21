import urllib2
import sys
import re
import base64
import httplib
import os
import time
from datetime import datetime, timedelta
from urlparse import urlparse
import common
import config

try:
    import json
except ImportError:
    import simplejson as json
from HTMLParser import HTMLParser
import urllib
import urllib2
import smtplib
import xmlrpclib
from threading  import Thread, Lock
from operator import itemgetter
import rethinkdb as r
import requests

debug=False

        
class AutoDLer():
    def __init__(self):
        db_conn_attempt = 0
        db_conn_max_attempts = 30
        while db_conn_attempt < db_conn_max_attempts:
            try:
                self.dbConn = r.connect( "localhost", 28015)
                if not r.db("bitflux").table_list().contains("autoDL").run(self.dbConn):
                    r.db("bitflux").table_create("autoDL").run(self.dbConn)
                r.db("bitflux").table("autoDL").wait().run(self.dbConn)
                break
            except:
                config.logging.error("Failed to connect to the database, retrying")
                db_conn_attempt += 1
                time.sleep(1)
        if db_conn_attempt >= db_conn_max_attempts:
            config.logging.error("Max attempts to connect to the database reached, exiting")
            sys.exit(1)

    def pollNewTvShows(self):
        while True:
            config.logging.info("Auto dler, downloading server feed")
            self.dl_server_feed()
            config.logging.info("Done downloading server feed... now sleeping")
            time.sleep(5)
    
    def matchWithShows(self, entry_name_from_server):
        entry_name_from_server = entry_name_from_server.lower()
        entry_name_from_server = entry_name_from_server.replace("."," ")
        cursor = r.db("bitflux").table("autoDL").run(self.dbConn)
        for a_show in cursor:
            longest_matched_entry = {}
            for a_show_name in a_show['filenames_to_match']:
                a_show_name = a_show_name.lower()
                config.logging.debug('attempting to match: ' + a_show_name + " and "+ entry_name_from_server)
                extract_SE = re.match(".*("+a_show_name+").*?[sS]?(\\d{2})[eE]?(\\d{2}).*", entry_name_from_server)
                if extract_SE is None:
                    config.logging.debug("did not match "+ a_show_name)
                    extract_SE = re.match(".*?("+a_show_name+").*?[sS]?(\\d{1})[eE]?(\\d{2}).*", entry_name_from_server)
                    if extract_SE is None:
                        config.logging.debug("did not match "+ a_show_name)
                        extract_SE = re.match(".*?("+a_show_name+").*?[sS]?(\\d{1})[eE]?(\\d{1}).*", entry_name_from_server)
                        if extract_SE is None:
                            config.logging.debug("did not match "+ a_show_name)
                            #This does not match this show
                            continue         
                #If reached this part it has matched 'a_show' to the 'name'
                config.logging.debug('matched! ' + entry_name_from_server)
                show_group = extract_SE.groups()
                season_found = int(show_group[1])
                episode_found = int(show_group[2])
                if not longest_matched_entry.has_key('name') or len(longest_matched_entry['name']) < len(a_show_name):      
                    longest_matched_entry['name'] = a_show_name
                    longest_matched_entry['season_found'] = season_found
                    longest_matched_entry['episode_found'] = episode_found
            if len(longest_matched_entry) > 0:  
                return True, longest_matched_entry['season_found'], longest_matched_entry['episode_found'], a_show
        config.logging.debug("did not match any autoDL entries: " + entry_name_from_server)
        return False, -1, -1, None
        
    def email_notification(self, dl_name,email_address):
        fromaddr = config.EMAIL_FROM_ADDR
        toaddrs  =  email_address
        msg = ("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n"
               % (fromaddr, toaddrs,"Bitflux Notification"))
    
        msg = msg + "~BitFlux~ is notifying you of a new automatic download: "+dl_name
    
        server = smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(config.EMAIL_FROM_ADDR, config.EMAIL_FROM_PASSWD)
        #server.set_debuglevel(1)
        server.sendmail(fromaddr, toaddrs, msg)
        server.quit()
        config.logging.info("Email notification sent to: "+email_address+" for DL: "+dl_name)
        
    def newDLtoAdd(self, url, auto_dl_entry, filename,found_season,found_episode,size):
        #out = dl_dir + filename
        try:
            filename = unicode(filename, errors='ignore')
        except TypeError:   #if type error occurs, just pass, use filename untouched
            pass
        #Create the new Job
        new_job = {}
        new_job['autorename'] = False
        new_job['filename'] = filename
        dir_list = auto_dl_entry['local_basedir'].split(os.sep)
        dir = dir_list[-1]
        if dir == "":
            dir = dir_list[-2]
        new_job['local_basedir'] = auto_dl_entry['local_basedir'] + os.sep + dir + " Season " + str(found_season)
        new_job['status'] = 'New; Queue'
        new_job['url'] = url
        new_job['totalLength'] = size
        found_season = str(found_season)
        try:
            new_job_post_data = {}
            new_job_post_data['newDL'] = True
            new_job_post_data['URL'] = url
            new_job_post_data['withAutoRename'] = False
            new_job_post_data['queue'] = True
            new_job_post_data['filename'] = filename
            new_job_post_cookie = {'cwd':new_job['local_basedir']}
            res = requests.post('http://localhost:3001',data=new_job_post_data,cookies=new_job_post_cookie)
            #r.db('bitflux').table('jobs').insert(new_job).run()
            #Create the new Log
            cursor = r.db('bitflux').table('autoDL').filter(auto_dl_entry).run(self.dbConn)
            for auto_dl_db_entry in cursor:
            	if not auto_dl_entry['download_log'].has_key(found_season):
                    auto_dl_entry['download_log'][found_season] = []
                auto_dl_entry['download_log'][found_season].append(found_episode)
                r.db('bitflux').table('autoDL').filter(auto_dl_db_entry).update(auto_dl_entry).run(self.dbConn)
            #send email notifications
            for email_addr in config.EMAIL_TO_LIST:
                #send email notifications
                self.email_notification(filename, email_addr)
        except:
            config.logging.exception("Failed to connect and add download: " + filename)
        
    
        
    def check_show_logs(self, show,S,E):
        S = str(S)
        if not show['download_log'].has_key(S):
            return False
        if int(E) in show['download_log'][S]:
            return True
        return False
        
    def search_server_feed(self, full_torrent_listing):
        for entry in full_torrent_listing:
            if entry[1] == 0:   #there are no bytes remaining for the download
                filename = entry[2]
                config.logging.debug("search_server_feed checking "+ filename)
                is_match, season_found, episode_found, a_show = self.matchWithShows(filename)
                if is_match:
                    if season_found > int(a_show['season_to_start']) or (season_found == int(a_show['season_to_start']) and episode_found >= int(a_show['episode_to_start'])):
                        #if season_found >= a_show['season_to_start'] and episode_found >= a_show['episode_to_start']:
                        if self.check_show_logs(a_show,season_found,episode_found) == False: #make sure we have not already DLed it
                            count = 0
                            URLS = []
                            size = -1
                            config.logging.debug("found show that needs to be downloaded...")
                            file_list_url = config.RUTORRNET_URL + "/plugins/listfiles/action.php?hash=" + entry[0] + "&list=True"
                            m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", file_list_url)
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
                                    conn = httplib.HTTPSConnection(mvals['host'],mvals['port'], timeout=30)
                                else:
                                    conn = httplib.HTTPConnection(mvals['host'],mvals['port'], timeout=30)
                                conn.request('GET',mvals['path'],params,headers);
                                response = conn.getresponse()
                                content = response.read()
                                config.logging.debug("retrieved file list for torrent")
                                json_reponse = json.loads(content)
                                config.logging.debug("loaded response into json format")
                            except:
                                config.logging.critical("Failed to retrieve file list for torrent: " + entry[0])
                                continue
                            if len(json_reponse['files']) > 1:
                                config.logging.debug("more then file in the torrent, skipping for now...")
                                continue
                            elif len(json_reponse['files']) == 1:
                                torrent_file = json_reponse['files'][0]
                                file_type = torrent_file['name'].split(".")[-1]
                                if file_type in config.EXTENSIONS:
                                    config.logging.debug("its a file type that is wanted")
                                    tv_show_rename = common.get_espisode_info(a_show['proper_name'], season_found, episode_found)
                                    tv_show_rename += "." + file_type
                                    #tv_show_rename = a_show['proper_name'] + " S" + str(season_found) + " E" + str(episode_found) + "." + file_type
                                    config.logging.info("Found Show to DL: "+tv_show_rename)
                                    full_url = config.RUTORRNET_URL + torrent_file["fullpath"]
                                    status, filename, size = common.getEntryInfo(full_url)
                                    if STANDALONE == False:
                                        self.newDLtoAdd(full_url,a_show,tv_show_rename, season_found ,episode_found,size)
                                else:
                                    continue
                                
                            else:
                                config.logging.info("count for hash: " +entry[0] + ", was 0! data plugin for rutorrent must be broken :( ");
                        else:
                            config.logging.debug(filename + " s" +str(season_found)  +" e"+str(episode_found) +" has already been downloaded")
                    else:
                        config.logging.debug(filename + " s" +str(season_found)  +" e"+str(episode_found) + " is not greater then s" + str(a_show['season_to_start']) + " e" +str(a_show['episode_to_start']) )
                        
    
        
    def dl_server_feed(self):
        #log_to_file('Requesting list from server...')
        try:
            URL = config.RUTORRNET_URL + "/plugins/rpc/rpc.php"
            add_name_pass = config.USERNAME + ":" + config.PASSWORD + "@"
            URL = URL.replace("://","://"+add_name_pass)
            proxy = xmlrpclib.ServerProxy(URL)
            result = proxy.d.multicall("main","d.get_hash=","d.get_left_bytes=","d.get_name=","d.get_base_path=")
        except Exception,e:
            config.logging.info("Failed to retrieve page from server: "+str(e))
            return
        config.logging.info("Torrent list downloaded from server")
        config.logging.debug("Retrieve page from server, sending to be parsed")
        self.search_server_feed(result)
    
if __name__ == '__main__':
    STANDALONE = False
    autodl = AutoDLer()
    autodl.pollNewTvShows()
    '''
    autodl.email_notification("some filename", "kyle@schinkels.net")
    sys.exit(0)
    a_show_name = "2 broke girls"
    entry_name_from_server = "2 broke girls 217 hdtv mp4"
    extract_SE = re.match(".*?("+a_show_name+").*?[sS]?(\\d{1})[eE]?(\\d{2}).*", entry_name_from_server)
    print extract_SE
    new_autodl_entry("2 Broke Girls", ["2 Broke Girls"], 2, 16, "/")
    autodl = AutoDLer(None)
    autodl.start()
    '''
    

                
