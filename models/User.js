const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    rating: { type: Number, default: 1200 }
});


UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 8);
    next();
});

UserSchema.methods.validPassword = async function(password) {
    return await bcrypt.compareSync(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);
