====================
node-bitcoin-bootstrap
====================

Node.JS script for importing unspent transaction outs to the Redis.

Requirements
============

    * `Redis`
    * `Bitcoin bootstrap.dat file` (http://archive.org/details/bitcoin_bootstrap.dat)

Installation
============

To install all dependencies please run the following command in the project folder::

    npm install

Usage
=====

Please make sure that your redis-server is running and run following command::

    node importBlocks.js /path/to/bootstrap.dat
