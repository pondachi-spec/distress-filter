const mongoose = require('mongoose');

const foreclosureRecordSchema = new mongoose.Schema({
    caseNumber:    { type: String, unique: true },
    caseType:      String,
    fileDate:      Date,
    plaintiff:     String, // bank / lender
    defendant:     String, // homeowner name
    propertyAddress: String, // normalized uppercase
    city:          String,
    zip:           String,
    source:        { type: String, default: 'HC-CLERK' },
    createdAt:     { type: Date, default: Date.now }
});

// Index on normalised address for fast lookup
foreclosureRecordSchema.index({ propertyAddress: 1 });
foreclosureRecordSchema.index({ zip: 1 });

module.exports = mongoose.model('ForeclosureRecord', foreclosureRecordSchema);
