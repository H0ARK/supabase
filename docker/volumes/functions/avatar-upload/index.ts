// Avatar Upload Edge Function
// Handles secure avatar uploads to Supabase Storage
// Simplified version to debug 500 error and fix kong:8000 issue

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      throw new Error('Method not allowed');
    }

    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Create Supabase client with user's token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader }
        }
      }
    );

    // Get the current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Invalid token');
    }

    // Parse the multipart form data
    const formData = await req.formData();
    const file = formData.get('avatar') as File;

    if (!file) {
      throw new Error('No file provided');
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('File must be an image');
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('File size must be less than 5MB');
    }

    // Create filename: user UUID + original extension (overwrites existing)
    const fileExt = file.name.split('.').pop() || 'jpg';
    const filePath = `${user.id}.${fileExt}`;

    // Convert file to Uint8Array for upload
    const fileBuffer = await file.arrayBuffer();
    const fileUint8Array = new Uint8Array(fileBuffer);

    // Upload file to Supabase Storage (upsert: true to overwrite)
    const { error: uploadError } = await supabaseClient.storage
      .from('avatars')
      .upload(filePath, fileUint8Array, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Get public URL
    let { data: { publicUrl } } = supabaseClient.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Fix for local development/internal networking issues (kong:8000)
    // If the URL contains kong:8000, we replace it with the external domain
    if (publicUrl.includes('kong:8000')) {
      // We know the external domain is api.rippzz.com from the environment
      publicUrl = publicUrl.replace('http://kong:8000', 'https://api.rippzz.com');
    }

    // Update user profile
    const { error: updateError } = await supabaseClient
      .from('profiles')
      .update({ 
        avatar_url: publicUrl, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', user.id);

    if (updateError) {
      console.warn('Failed to update profile:', updateError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        avatar_url: publicUrl,
        message: 'Avatar uploaded successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Avatar upload error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 // Changed from 500 to 400 to see if it's a caught error
      }
    );
  }
});