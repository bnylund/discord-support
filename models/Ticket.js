const Sequelize = require('sequelize')

module.exports = {
  user_id: {
    type: Sequelize.STRING,
  },
  channel: {
    type: Sequelize.STRING,
  },
  status: {
    type: Sequelize.STRING,
  },
  _id: {
    type: Sequelize.STRING,
    unique: true,
  },
}
