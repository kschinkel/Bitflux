FROM centos:7
RUN yum install -y wget
# install nginx
RUN yum install -y epel-release
RUN yum install -y nginx
RUN yum install -y bzip2
# install nodejs
RUN curl --silent --location https://rpm.nodesource.com/setup_6.x | bash -
RUN yum -y install nodejs
# install rethinkdb
RUN wget http://download.rethinkdb.com/centos/7/`uname -m`/rethinkdb.repo -O /etc/yum.repos.d/rethinkdb.repo
RUN yum install -y rethinkdb
# install aria2c
RUN yum install -y aria2

RUN mkdir /opt/bitflux
COPY bitflux_process_manager.js /opt/bitflux/

CMD ["node","/opt/bitflux/bitflux_process_manager.js"]

EXPOSE 8080 80