const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
    address: { type: String, required: true },
    city: String,
    state: String,
    zip: String,
    ownerName: String,
    ownerPhone: String,
    equityPercent: { type: Number, default: 0 },
    estimatedValue: Number,
    loanBalance: Number,
    isAbsenteeOwner: { type: Boolean, default: false },
    yearsOwned: { type: Number, default: 0 },
    isPreForeclosure: { type: Boolean, default: false },
    isTaxDelinquent: { type: Boolean, default: false },
    propertyType: String,
    motivationScore: { type: Number, default: 0 },
    motivationClass: { type: String, enum: ['HOT', 'WARM', 'COLD'], default: 'COLD' },
    status: { type: String, enum: ['new', 'sent_to_alisha', 'calling', 'qualified', 'abandoned'], default: 'new' },
    attomId: String,
    source: { type: String, default: 'ATTOM' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lead', leadSchema);
