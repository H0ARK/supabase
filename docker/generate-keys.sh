#!/bin/bash

# JWT Secret - using a fixed one for reproducibility
JWT_SECRET="bJHgRRhS729pBo2VijCgoqL3kDfvxxea4Ey7gyEJNRHXwqYw"

# Install Node.js if needed for JWT generation
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Create a simple JWT generator script
cat > /tmp/jwt-gen.js << 'EOF'
const crypto = require('crypto');

function base64url(source) {
    let encodedSource = Buffer.from(JSON.stringify(source)).toString('base64');
    encodedSource = encodedSource.replace(/=+$/, '');
    encodedSource = encodedSource.replace(/\+/g, '-');
    encodedSource = encodedSource.replace(/\//g, '_');
    return encodedSource;
}

function sign(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const segments = [base64url(header), base64url(payload)];
    const signature = crypto
        .createHmac('sha256', secret)
        .update(segments.join('.'))
        .digest('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    segments.push(signature);
    return segments.join('.');
}

const secret = process.argv[2];
const role = process.argv[3];

const payload = {
    role: role,
    iss: 'supabase',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) // 10 years
};

console.log(sign(payload, secret));
EOF

ANON_KEY=$(node /tmp/jwt-gen.js "$JWT_SECRET" "anon")
SERVICE_KEY=$(node /tmp/jwt-gen.js "$JWT_SECRET" "service_role")

echo "JWT_SECRET=$JWT_SECRET"
echo ""
echo "ANON_KEY=$ANON_KEY"
echo ""
echo "SERVICE_ROLE_KEY=$SERVICE_KEY"
