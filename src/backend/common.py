from HTMLParser import HTMLParser
import re
import httplib
import urllib
import urllib2
try:
    import json
except ImportError:
    import simplejson as json
import xmlrpclib
import config
import tvdb_api

class MyHTMLParser(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self)
        self.links=[]
        self.links_with_dir=[]
        self.parent_job_status = ""
        self.parent_job_url = ""
        self.parent_job_local_dir = ""
        self.parent_job_autorename = False
    
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            a_link = attrs[0][1]
            if a_link.endswith('/') and not a_link.startswith("/"):
                new_job = {}
                new_job['autorename'] = self.parent_job_autorename
                new_job['filename'] = name_wrapper(a_link)
                new_job['local_basedir'] = self.parent_job_local_dir
                new_job['status'] = 'New; Queue'
                new_job['url'] = self.parent_job_url + a_link
                new_job['totalLength'] = -1
                engine = xmlrpclib.ServerProxy('http://localhost:8000/bitfluxengine')
                if engine.newjob(new_job):
                   pass
               
            if a_link.endswith('.avi') or a_link.endswith('.mp3') or a_link.endswith('.mp4') or a_link.endswith('.mpg') or a_link.endswith('.rar') or a_link.endswith('.zip') or a_link.endswith('.nfo') or a_link.endswith('.sfv') or a_link.endswith('.mkv'):
                self.links.append(a_link)
            else:
                is_rar_archieve = re.match(".*\.r[0-9]*$", a_link)
                if is_rar_archieve is not None:
                   self.links.append(a_link)
    def set_links_with_dir(self, dir):     
        for entry in self.links:
            sep_link =  entry.split('/')
            filename = sep_link[len(sep_link)-1]
            #filename = urllib.quote(filename)
            self.links_with_dir.append(dir+filename)
        return self.links_with_dir
    
    def set_parent_info(self, full_url, local_directory, status, autorename): 
        self.parent_job_status = status
        self.parent_job_url = full_url
        self.parent_job_local_dir = local_directory
        self.parent_job_autorename = autorename
        
    
def convert_bytes(bytes):
    bytes = float(bytes)
    if bytes >= 1099511627776:
        terabytes = bytes / 1099511627776
        size = '%.2fTB' % terabytes
    elif bytes >= 1073741824:
        gigabytes = bytes / 1073741824
        size = '%.2fGB' % gigabytes
    elif bytes >= 1048576:
        megabytes = bytes / 1048576
        size = '%.2fMB' % megabytes
    elif bytes >= 1024:
        kilobytes = bytes / 1024
        size = '%.2fKB' % kilobytes
    else:
        size = '%.2fB' % bytes
    return size
    
    
def convert_time(seconds):
    seconds = float(seconds)
    if seconds >= 31556926:
        years = seconds / 31556926
        format = '%.2fy' % years
    elif seconds >= 2629743.83:
        months = seconds / 2629743.83
        format = '%.2fM' % months
    elif seconds >= 604800:
        weeks = seconds / 604800
        format = '%.2fw' % weeks
    elif seconds >= 86400:
        days = seconds / 86400
        format = '%.2fd' % days
    elif seconds >= 3600:
        hours = seconds / 3600
        format = '%.2fh' % hours
    elif seconds >= 60:
        minutes = seconds /  60
        format = '%.2fm' % minutes
    else:
        format = '%.2fs' % seconds    
    return format  
    
    
def getEntryInfo(URL):
    m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", URL)
    mvals = m.groupdict()
    if mvals['port'] is None:
        mvals['port'] = 80
        if mvals['type'] == 'https':
            mvals['port'] = 443

    basic_auth = config.USERNAME + ":" + config.PASSWORD
    encoded = basic_auth.encode("base64")[:-1]
    headers = {"Authorization":"Basic %s" % encoded}
    params = ""
    try:
        data = urllib.urlencode(params)
        request = urllib2.Request(URL, data, headers)
        response = urllib2.urlopen(request)
        cookie_handler= urllib2.HTTPCookieProcessor()
        redirect_handler = urllib2.HTTPRedirectHandler()
        opener = urllib2.build_opener(redirect_handler,cookie_handler)
        response = opener.open(request)
        size = response.info().getheader("content-length")
        #
        #Content-Disposition: attachment; filename="ringer.s01e17.what.we.have.is.worth.the.pain.hdtv.xvid-2hd.avi"
        try:
            filename_raw = response.info().getheader("content-disposition")
            filename_raw = filename_raw.replace("attachment; filename=","")
            filename_raw = filename_raw.strip('"')
            filename = filename_raw.rstrip('"')
        except:
            filename_raw = response.geturl()
            filename_list = filename_raw.split('/')
            filename = filename_list.pop()
        
    except Exception,e:
        #print "Failed to retrieve page from server: "+str(e)
        return False, "", -1

    if response.getcode() == 200:
        #filename_list = filename_raw.split('/')
        #filename = filename_list.pop()
        return True, filename, size
    else:
        return False, "", -1
        
        
def getContentLength(URL):
    m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", URL)
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
        responce = conn.getresponse()
        size = responce.getheader("content-length")
        conn.close()
    except Exception,e:
        return -1
    return size

def get_espisode_info(name, season, episode):
    season = int(season)
    episode = int(episode)
    full_name = name
    full_name += " S" + str(season).zfill(2)
    full_name += " E" + str(episode).zfill(2)
    try:
        tvdb = tvdb_api.Tvdb()
        tvdb_episode = tvdb[name][season][episode]
        episode_name = tvdb_episode['episodename']
        full_name = tvdb[name]['seriesname']
        full_name += " S" + str(season).zfill(2)
        full_name += " E" + str(episode).zfill(2)
        full_name +=  " - " + episode_name
    except:
        pass
    return full_name
	
        
def get_espisode_info_tvrage(name, season, episode): # tv rage api no longer works... moved to tvdb
    name = name.replace(" ","%20")
    #http://services.tvrage.com/tools/quickinfo.php?show=Bones&exact=1&ep=2x04
    base_URL = "http://services.tvrage.com/tools/quickinfo.php"
    show_str = "?show="+name
    options = "&exact=1"
    episode_str = "&ep=" + str(season) + "x" + str(episode)
    full_URL = base_URL + show_str + options + episode_str
    m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", full_URL)
    mvals = m.groupdict()
    if mvals['port'] is None:
        mvals['port'] = 80
    try:
        conn = httplib.HTTPConnection(mvals['host'],mvals['port'], timeout=60)
        conn.request('GET',mvals['path'],"");
        responce = conn.getresponse()
        fullhtmlpage = responce.read()
        conn.close()
    except Exception,e:
        show_name = name
        show_name += " S" + str(season).zfill(2)
        show_name += " E" + str(episode).zfill(2)
        #show_name += name[name.rfind("."):]
        return show_name        
    start_episode_info =  fullhtmlpage.find("Episode Info")
    sub_string1 = fullhtmlpage[start_episode_info:]
    start_episode_name = sub_string1.find("^")
    sub_string2 = sub_string1[start_episode_name+1:]
    end_episode_name = sub_string2.find("^")
    episode_name = sub_string1[start_episode_name+1:end_episode_name+start_episode_name+1]
    
    start_show_name =  fullhtmlpage.find("Show Name")
    sub_string1 = fullhtmlpage[start_show_name:]
    start_episode_name = sub_string1.find("@")
    sub_string2 = sub_string1[start_episode_name+1:]
    end_episode_name = sub_string2.find("\n")
    show_name = sub_string1[start_episode_name+1:end_episode_name+start_episode_name+1]
    
    if show_name == "":
        show_name = name
    show_name += " S" + str(season).zfill(2)
    show_name += " E" + str(episode).zfill(2)
    show_name +=  " - " + episode_name
    #show_name += name[name.rfind("."):]
    show_name = show_name.decode('utf-8', 'ignore')
    return show_name    
    #return show_name, episode_name  
        
    
def is_tv_show(param):
    raw_name = param.encode('ascii', 'ignore')
    raw_name = raw_name.replace(' ','.');
    raw_name = raw_name.lower()

    extract_SE = re.match("(.*)[sS](\\d{2})[eE](\\d{2}).*", raw_name)
    if extract_SE is None:
        #print 'failed match 1'
        extract_SE = re.match("(.*)[sS](\\d{1})[eE](\\d{2}).*", raw_name)
        if extract_SE is None:
            #print 'failed match 2'
            extract_SE = re.match("(.*)[sS](\\d{1})[eE]?(\\d{1}).*", raw_name)
            if extract_SE is None:
                #print 'failed match 3'
                extract_SE = re.match("(.*)(\\d{2})[xX](\\d{2}).*", raw_name)
                if extract_SE is None:
                    #print 'failed match 4'
                    extract_SE = re.match("(.*)(\\d{1})[xX](\\d{2}).*", raw_name)
                    if extract_SE is None:
                        #print 'failed match 5'
                        extract_SE = re.match("(.*)(\\d{1})[xX](\\d{1}).*", raw_name)
                        if extract_SE is None:
                            #print 'failed match 6'
                            #This does not match a show
                            return "", -1, -1
    
    
    show_group = extract_SE.groups()
    extracted_name = show_group[0]
    extracted_season = int(show_group[1])
    extracted_episode = int(show_group[2])
    extracted_name = extracted_name.replace('.',' ')
    extracted_name = extracted_name.replace('-',' ')
    return extracted_name, extracted_season, extracted_episode
  
  
def format_movie(raw_name):
    raw_name = raw_name.lower()
    raw_name = raw_name.replace('.',' ')
    parts = raw_name.split(' ')
    #https://dl.vpnhub.ca/downloads/The.Super.2011.DvDScr.XviD.AC3-XtremE/The.Super.2011.DvDScr.XviD.AC3-XtremE.avi
    common_tags = [ '480p','720p','1080p','1080i',
                    'xvid','ac3','brrip','bdrip','bluray','dvdrip',
                    'cd','dvd','dvd9','r5','r4','r3','ts','cam','dvdscr',
                    'dvdscreener','vhsscreener','ppvrip','iflix',
                    'vision','ika','readnfo','XtremE']


    name = ""
    for part in parts:
        if part not in common_tags:
            name += part + " "
        else:
        #Once 1 tag is found stop
            break
    return name

def is_movie(raw_name):
    #http://www.imdbapi.com/?i=&t=The+Italian+Job+2003
    api_url = "http://www.imdbapi.com/?i=&t=" + format_movie(raw_name)
    api_url = api_url.replace(" ","%20")
    m = re.match(r"(?P<type>[^:]+)://(?P<host>[^:/]+)(:(?P<port>\d+))?(?P<path>.*)", api_url)
    mvals = m.groupdict()
    if mvals['port'] is None:
        mvals['port'] = 80
    fullhtmlpage = ""
    try:
        conn = httplib.HTTPConnection(mvals['host'],mvals['port'], timeout=30)
        conn.request('GET',mvals['path'],"");
        responce = conn.getresponse()
        fullhtmlpage = responce.read()
        result = json.loads(fullhtmlpage)
        conn.close()
    except Exception,e:
        #log_to_file("is_movie: Failed to retrieve show name using URL: " + api_url)
        #log_to_file("is_movie: Exception was value: " + str(e))
        return ""
    
    if result['Response'] == "Parse Error" or 'Title' not in result or 'Year' not in result:
        return ""
    format =  result['Title'] + " (" + result['Year'] + ")"
    format += raw_name[raw_name.rfind("."):]
    return format
    
def name_wrapper(raw_name):
    fixed_name = urllib.unquote(raw_name)
    fixed_name = fixed_name.replace('\\','')
    fixed_name = fixed_name.replace('/','')
    fixed_name = fixed_name.replace(':','')
    fixed_name = fixed_name.replace('*','')
    fixed_name = fixed_name.replace('?','')
    fixed_name = fixed_name.replace('"','')
    fixed_name = fixed_name.replace('<','')
    fixed_name = fixed_name.replace('>','')
    fixed_name = fixed_name.replace('|','')
    return fixed_name

if __name__ == '__main__':
    name = "duck.dynasty.s03e01-killers.mp4"
    #print is_tv_show(name)
    print get_espisode_info("Duck Dynasty","2","2")