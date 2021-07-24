@echo off
set VER=2.1.4

sed -i -E "s/version>.+?</version>%VER%</" install.rdf
sed -i -E "s/version>.+?</version>%VER%</; s/download\/.+?\/moon-tester-tool-.+?\.xpi/download\/%VER%\/moon-tester-tool-%VER%\.xpi/" update.xml

set XPI=moon-tester-tool-%VER%.xpi
if exist %XPI% del %XPI%
zip -r9q %XPI% * -x .git/* .gitignore update.xml LICENSE README.md *.cmd *.xpi *.exe
