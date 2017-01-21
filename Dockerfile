FROM centos:7
RUN yum install -y wget
# install nginx
RUN yum install -y epel-release
RUN yum install -y nginx
RUN yum install -y bzip2
# install nodejs
RUN curl --silent --location https://rpm.nodesource.com/setup_6.x | bash -
RUN yum -y install nodejs
RUN yum install -y gcc-c++
# install rethinkdb
RUN wget http://download.rethinkdb.com/centos/7/`uname -m`/rethinkdb.repo -O /etc/yum.repos.d/rethinkdb.repo
RUN yum install -y rethinkdb
# install aria2c
RUN yum install -y aria2

RUN yum install -y python-pip
RUN easy_install tvdb_api
RUN easy_install rethinkdb
RUN easy_install requests
RUN yum install -y python-devel

RUN gpg --keyserver pool.sks-keyservers.net --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4 \
    && curl -o /usr/local/bin/gosu -SL "https://github.com/tianon/gosu/releases/download/1.2/gosu-amd64" \
    && curl -o /usr/local/bin/gosu.asc -SL "https://github.com/tianon/gosu/releases/download/1.2/gosu-amd64.asc" \
    && gpg --verify /usr/local/bin/gosu.asc \
    && rm /usr/local/bin/gosu.asc \
    && rm -r /root/.gnupg/ \
    && chmod +x /usr/local/bin/gosu

RUN mkdir /opt/bitflux
COPY bitflux_process_manager.js /opt/bitflux/
COPY src /opt/bitflux/src
WORKDIR /opt/bitflux/src/backend
RUN npm install .
WORKDIR /

COPY config/nginx.conf /etc/nginx/
COPY config/config.py /opt/bitflux/src/backend/

RUN mkdir /downloads

CMD ["node","/opt/bitflux/bitflux_process_manager.js"]

EXPOSE 8080 80
