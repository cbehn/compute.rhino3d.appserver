---
trigger: always_on
description: This should be used when doing changes that effect to the app-server container.
---

When updating the server, always close and delete the current docker container and image before you rebuild. Rebuild the docker image called app-server. Then run the docker serer using docker run -d -p 2002:80 --env-file .env -v "$(pwd):/usr/src/app" -v /usr/src/app/node_modules --name app-server app-server npm run dev
Perform all your checks and testing using this version of the docker. When you are done testing, leave the docker running.
