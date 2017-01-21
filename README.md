# bitflux
Bitflux is a web UI based manual and automatic downloader FROM rutorrent to a local machine. Now with more Docker!!
The automatic downloader is specifically for TV Shows. The TV Shows are renamed and downloaded to formatted directories; 'Show Name/Season X/Show Name S# E# Episode Name.mkv'
The automatic download will also send a email when new TV shows are found, if configured.
There is also a basic file broswer in the web ui.

# Config
Config files are under 'config'. Really only config.py should need to be updated with your rutorrent and email settings.
This file could be updated before the build and included in the contianer, or mount it as a volume once the container is already built; /opt/bitflux/src/backend/config.py

# Build
docker build -t bitflux .

# Run
docker run -d --restart=always -p 80:80 -e MOUNT_UID=500 -e MOUNT_GID=500 -v /mnt/Data:/downloads -v /var/www/html/.htpasswd:/opt/bitflux/.htpasswd -v /rethinkdb_bitflux:/rethinkdb_data --name bitflux bitflux

MOUNT_UID and MOUNT_GID are the user id and group id to use when writting files to /downloads inside the container.
By default bitflux UI is password protected, and you need to provide a .htpasswd file to /opt/bitflux/.hapasswd.
Bitflux uses rethinkdb to store data. This data should be stored outside the container, but mounted at /rethinkdb_data
