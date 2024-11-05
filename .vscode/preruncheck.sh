#!/bin/bash
MOUNTED=$(mount | grep '//rr-synol1.lan/music on' | wc -l)

if [ $MOUNTED -eq 0 ]; then
    echo "Mounting music share"
    sudo mount -t cifs -o username=markrad,password=12DancingCows*,vers=3.0 //rr-synol1.lan/music /home/markrad/source/streamiumServer/music
fi