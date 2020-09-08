const express = require("express");
const router = express.Router();
const moment = require("moment");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { v4: uuid } = require("uuid");
//Local imports-----------------------------------------
const UserRecord = require("../models/UserRecord");
const { Response } = require("../models/Response");
const emailHandler = require("../src/emailHandler");
const middleware = require("../src/middleware");
const ObjectId = require("mongodb").ObjectId;
const saltRounds = 10;
const secretKey = "secretkey";

/**
 * Checks if a users login is correct
 * @param email email of the users
 * @param googleid google id of the user
 * @param password password of the user
 * @returns {UserRecord} the record of the user
 */
router.route("/login").post(async (req, res) => {
  const email = req.body.email;
  const googleId = req.body.googleId;
  const password = req.body.password;

  if (googleId) {
    //google login
    await UserRecord.findOne({ googleId: googleId, email: email })
      .then((record) => {
        if (record) {
          jwt.sign({ record }, secretKey, { expiresIn: "1d" }, (err, token) => {
            let response = new Response(true, null, record);
            response.token = token;
            res.send(response);
          });
        } else {
          let response = new Response(
            false,
            "Unable to find the account.",
            null
          );
          res.send(response);
        }
      })
      .catch(() => {
        let response = new Response(false, "An error occured", null);
        res.send(response);
      });
  } else {
    await UserRecord.findOne({ email: email })
      .then((record) => {
        if (record.isGmail) {
          let response = new Response(false, "Please log in with google", null);
          res.send(response);
        } else {
          bcrypt.compare(password, record.password, function (err, result) {
            if (err) {
              let response = new Response(false, "An error occured", null);
              res.send(response);
            }
            if (result) {
              jwt.sign(
                { record },
                secretKey,
                { expiresIn: "1d" },
                (err, token) => {
                  let response = new Response(true, null, record);
                  response.token = token;
                  res.send(response);
                }
              );
            } else {
              let response = new Response(false, "Incorrect password", null);
              res.send(response);
            }
          });
        }
      })
      .catch(() => {
        let response = new Response(false, "Unable to find the account.", null);
        res.send(response);
      });
  }
});

/**
 * Creates an account in MongoDB
 * @param email email of the users
 * @param firstName
 * @param lastName
 * @param googleid google id of the user
 * @param password password of the user
 * @returns {UserRecord} the record of the user
 */
router.route("/signup").post(async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  const firstName = req.body.firstName;
  const lastName = req.body.lastName;
  const googleId = req.body.googleId;
  const profilePic = req.body.profilePic;
  const rooms = [];
  const emailedIsVerified = false;
  const emailVerification = uuid();
  const friends = [];
  const inviteCode = makeid(6);
  const invitedUsers = [];
  const friendRequests = [];
  const timeCreated = moment().format();
  const waitlist = (await getTotalUsersOnWaitlist()) + 1;
  let hashPassword = "";
  if (password === null) {
    password = "";
  }
  bcrypt.hash(password, saltRounds, async function (err, hash) {
    hashPassword = hash;
    const newUser = {
      email: email,
      password: hashPassword,
      firstName: firstName,
      lastName: lastName,
      googleId: googleId,
      profilePic: profilePic,
      rooms: rooms,
      emailedIsVerified: emailedIsVerified,
      emailVerification: emailVerification,
      friends: friends,
      friendRequests: friendRequests,
      timeCreated: timeCreated,
      waitList: waitlist,
      inviteCode: inviteCode,
      invitedUsers: invitedUsers,
    };

    if (googleId) {
      newUser.emailedIsVerified = true;
    }

    var newUserRecord = new UserRecord(newUser);

    await UserRecord.findOne({ email: email })
      .then((record) => {
        if (record) {
          let response = new Response(false, "Account Exists", null);
          res.send(response);
        } else {
          newUserRecord
            .save()
            .then(() => {
              let response = new Response(true, null, newUser);
              emailHandler.verifyEmail(email, emailVerification);
              jwt.sign(
                { record },
                secretKey,
                { expiresIn: "1d" },
                (err, token) => {
                  response.token = token;
                  res.send(response);
                }
              );
            })
            .catch(() => {
              let response = new Response(false, "An error occured", null);
              res.send(response);
            });
        }
      })
      .catch(() => {
        let response = new Response(false, "An error occured", null);
        res.send(response);
      });
  });
});

router.route("/test").post(middleware.verifyIp, async (req, res) => {
  res.send("valid ip");
});

/**
 * Gets a user's record by their email
 * @param emailVerificationCode the email of the user
 * @returns {UserRecord} the record of the user
 */
router.route("/get/:email").get(middleware.verifyToken, async (req, res) => {
  const email = req.params.email;
  jwt.verify(req.token, secretKey, async (err, payload) => {
    if (err) {
      res.status(403).send("Invalid authorization token");
    } else {
      await UserRecord.findOne({ email: email })
        .then((record) => {
          let response = new Response(true, null, record);
          res.send(response);
        })
        .catch((err) => {
          let response = new Response(false, "Email not found", null);
          res.send(response);
        });
    }
  });
});

/**
 * Adds friend to user
 * @param email the email of the user who is adding a friend
 * @param friendId the id of the friend
 * @returns {UserRecord} the record of the user
 */
router
  .route("/addFriend/:email")
  .post(middleware.verifyToken, async (req, res) => {
    const email = req.params.email;
    const friendId = req.body.friendId;
    jwt.verify(req.token, secretKey, async (err, payload) => {
      if (err) {
        res.status(403).send("Invalid authorization token");
      } else {
        await UserRecord.findOne({ email: email })
          .then((record) => {
            let friendArr = record.friends;
            let index = friendArr.indexOf(friendId);
            if (index === -1) {
              // if not a duplicate
              record.friends.push(friendId);
              record.save();
              let response = new Response(true, null, record);
              res.send(response);
            } else {
              let response = new Response(false, "Already friends", null);
              res.send(response);
            }
          })
          .catch((err) => {
            let response = new Response(false, "Email not found", null);
            res.send(response);
          });
      }
    });
  });

/**
 * Checks if a users login is correct
 * @param code the email verification code
 * @returns {UserRecord} the record of the user
 */
router.route("/verifyEmail/:code").post(async (req, res) => {
  const code = req.params.code;

  await UserRecord.findOne({ emailVerification: code })
    .then((record) => {
      if (!record.emailedIsVerified) {
        record.emailedIsVerified = true;
        record
          .save()
          .then(() => {
            let response = new Response(true, null, record);
            res.send(response);
          })
          .catch((err) => {
            let response = new Response(false, "An error occured", null);
            res.send(response);
          });
      } else {
        let response = new Response(false, "Email is already verified", null);
        res.send(response);
      }
    })
    .catch((err) => {
      let response = new Response(false, "Unable to find the account.", null);
      res.send(response);
    });
});

/**
 * Removes friend from user
 * @param email email of the person trying to remove their friend
 * @param friendId the id of the friend were trying to remove
 * @returns {UserRecord} the record of the user
 */
router
  .route("/removeFriend/:email")
  .delete(middleware.verifyToken, async (req, res) => {
    const email = req.params.email;
    const friendId = req.body.friendId;
    jwt.verify(req.token, secretKey, async (err, payload) => {
      if (err) {
        res.status(403).send("Invalid authorization token");
      } else {
        await UserRecord.findOne({ email: email })
          .then((record) => {
            let friendArr = record.friends;
            let index = friendArr.indexOf(friendId);
            if (index === -1) {
              // if not a duplicate friend
              let response = new Response(false, "Not friends", null);
              res.send(response);
            } else {
              record.friends.splice(friendId);
              record.save();
              let response = new Response(true, null, record);
              res.send(response);
            }
          })
          .catch((err) => {
            let response = new Response(false, "Email not found", null);
            res.send(response);
          });
      }
    });
  });

/**
 * Sends the user an email with a link to reset their password
 * @param email the email of the user
 * @returns {UserRecord} the record of the user
 */
router.route("/sendResetPassword/:email").post(async (req, res) => {
  const email = req.params.email;
  await UserRecord.findOne({ email: email })
    .then((record) => {
      let resetPasswordCode = uuid();
      record.resetPassword = resetPasswordCode;
      record.save();
      emailHandler.resetPassword(email, resetPasswordCode);
      let response = new Response(
        true,
        null,
        "Successfully sent the password recovery email!"
      );
      res.send(response);
    })
    .catch((err) => {
      let response = new Response(false, "Email not found", null);
      res.send(response);
    });
});

/**
 * Reset Password
 * @param resetPasswordCode the email of the user
 * @param password //the new password for the user
 * @returns {UserRecord} the record of the user
 */
router.route("/resetPassword").post(async (req, res) => {
  const resetPasswordCode = req.body.resetPasswordCode;
  const password = req.body.password;
  bcrypt.hash(password, saltRounds, async function (err, hashPassword) {
    await UserRecord.findOne({ resetPassword: resetPasswordCode })
      .then((record) => {
        bcrypt.compare(password, record.password, function (err, result) {
          if (err) {
            let response = new Response(false, "An error occured", null);
            res.send(response);
          }
          if (result) {
            let response = new Response(
              false,
              "The new password must be different.",
              null
            );
            res.send(response);
          } else {
            record.password = hashPassword;
            record.save();
            let response = new Response(
              true,
              null,
              "Successfully reset the password!"
            );
            res.send(response);
          }
        });
      })
      .catch((err) => {
        let response = new Response(false, "Email not found", null);
        res.send(response);
      });
  });
});

/**
 * Creates a random string
 * @param length the length of the id
 * @returns {String} the randomly generated Id
 */
function makeid(length) {
  var text = "";
  var possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (var i = 0; i < length; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

module.exports = router;
