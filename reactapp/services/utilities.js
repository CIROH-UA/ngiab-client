import { v4 as uuidv4 } from "uuid";

function newUUID() {
  return uuidv4();
}

function getTethysPortalHost() {
    let tethys_portal_host = process.env.TETHYS_PORTAL_HOST;
  
    // If the .env property is not set, derive from current location
    if (!tethys_portal_host || !tethys_portal_host.length) {
      let currLocation = window.location.href;
      let url = new URL(currLocation);
      tethys_portal_host = url.origin;
    }
    return new URL(tethys_portal_host);
  }

export { getTethysPortalHost, newUUID };


