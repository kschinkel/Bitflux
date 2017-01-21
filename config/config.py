import logging
import sys

EXTENSIONS = ['avi','mp4','mkv'] # list of file extensions to look for. Used by the auto downloader
# Email notification settings
EMAIL_TO_LIST = []     # List of email addresses to send auto-downloaded items a notification to
EMAIL_FROM_ADDR = ''   # Email address of where to send the notifications from
EMAIL_FROM_PASSWD = '' # Password of the email address of where to send the notifications from
SMTP_SERVER = ''       # Name of SMTP server to use for sending email notifications
SMTP_PORT = 587    

# rutorent configuration for auto-downloader
# Note: rutorrent must have the 'listfiles' plugin installed for the auto-downloader to work
RUTORRNET_URL = '' # rutorrent base url
USERNAME=''        # Username for rutorrent
PASSWORD=''        # Password for rutorrent

# Logging config. could change to logging.DEBUG for more info if needed
logging.basicConfig(stream=sys.stdout, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%m/%d/%Y %I:%M:%S %p')
