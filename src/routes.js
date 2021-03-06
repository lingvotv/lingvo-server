﻿// @flow
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const socketio = require("./socketio");
const user = require("./user");
const features = require("./features");
const history = require("./history");
const stripe = require("./stripe");
const { UserModel } = require("./models");

const log = console.log.bind(console);
const error = console.error.bind(console);

class RequestType /*:: extends express$Request */ {
  state: {|
    userId?: bson$ObjectId,
  |};
}

type InitRoutesType = (express$Application /*:: <RequestType, express$Response> */) => void;

const initRoutes: InitRoutesType = (app) => {
  app.post(
    "/stripe/hooks",
    bodyParser.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const bodyBuffer: Buffer = (req.body: any);
        const data = await stripe.handleEvent(
          bodyBuffer,
          req.headers["stripe-signature"]
        );
        res.send(data);
      } catch (err) {
        error(err);
        return res.status(400).send({ error: err.message });
      }
    }
  );

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(
    (req: RequestType, res: express$Response, next: express$NextFunction) => {
      const userIdStr = req.get("x-user-id");
      const userId = userIdStr
        ? new mongoose.Types.ObjectId(userIdStr)
        : undefined;
      req.state = {
        userId,
      };
      next();
    }
  );
  app.use(
    (req: RequestType, res: express$Response, next: express$NextFunction) => {
      res.header(
        "Access-Control-Allow-Headers",
        "content-type, authorization, x-user-id"
      );
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE");
      next();
    }
  );

  app.get("/", (req, res) => {
    res.send("Ok.");
  });

  app.get("/stripe/prices", async (req, res) => {
    try {
      const data = await stripe.readPrices();
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  // TODO add oauth token validation middleware here

  app.put("/user", async (req, res) => {
    try {
      const userData: UserModel = (req.body: any);
      const data = await user.update(userData);
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.post("/subtitle", (req, res) => {
    const body: {|
      auth?: string,
      subtitle: string,
    |} = (req.body: any);
    const query: {| auth?: string |} = (req.query: any);

    // We used to send query.auth, but it doesn't work with "+" chars and probably others,
    // and we started to use email as auth.
    const auth = query.auth ? decodeURIComponent(query.auth) : body.auth;
    if (!auth) {
      const err = new Error("Auth is not provided");
      error(err);
      return res.status(400).send({ error: err.message });
    }
    const connected = socketio.sendSubtitle({ auth, subtitle: body.subtitle });
    res.send({ subtitle: body.subtitle, connected: connected });
  });

  app.post("/connected", (req, res) => {
    const body: {| auth: string |} = (req.body: any);
    const connected = socketio.getConnectedClients(body.auth);
    res.send({ connected: connected });
  });

  app.get("/stats", (req, res) => {
    res.send({ socketio: socketio.getStats() });
  });

  app.get("/features", async (req, res) => {
    try {
      if (!req.state.userId) {
        throw new Error("Unknown user");
      }
      const data = await features.read(req.state.userId);
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.post("/history", async (req, res) => {
    try {
      const data = await history.create({
        userId: req.state.userId,
        ...req.body,
      });
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.get("/history", async (req: RequestType, res: express$Response) => {
    try {
      if (!req.state.userId) {
        throw new Error("Unknown user");
      }
      const data = await history.read(req.state.userId);
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.put("/history/:id", async (req, res) => {
    try {
      // $FlowFixMe
      const data = await history.update(req.params.id, req.body);
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.delete("/history/:ids", async (req, res) => {
    try {
      const data = await history.del(req.params.ids.split(","));
      res.send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  app.get("/history/download/:userId", async (req, res) => {
    try {
      const userId: bson$ObjectId | void = (req.params.userId: any);
      if (!userId) {
        throw new Error("Unknown user");
      }
      const data = await history.download(userId);
      res.type("text/csv").send(data);
    } catch (err) {
      error(err);
      return res.status(400).send({ error: err.message });
    }
  });

  // Should always be the last.
  app.use(
    (
      err: Error,
      req: RequestType,
      res: express$Response,
      next: express$NextFunction
    ) => {
      console.error(err.stack);
      res.status(500).send("Something bad happened.");
    }
  );
};

module.exports = { initRoutes };
