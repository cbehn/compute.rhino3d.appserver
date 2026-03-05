---
trigger: always_on
description: This should be used when doing changes that effect to the app-server container.
---

When updating the server, always close the current docker container and rebuild the docker image called app-server. Then run the docker serer using -p 2002:80 and the .env file. Perform all your checks and testing using this version of the docker. When you are done testing, leave the docker running.
