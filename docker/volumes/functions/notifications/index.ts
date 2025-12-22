
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ===========================
// TYPE DEFINITIONS
// ===========================

type NotificationType = 
  | 'order_received'
  | 'order_shipped'
  | 'payment_received'
  | 'review_received'
  | 'outbid'
  | 'auction_won'
  | 'auction_ended'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'price_drop'
  // Legacy types for social features
  | 'like'
  | 'repost'
  | 'reply'
  | 'mention'
  | 'follow'
  | 'post';

interface MarketplaceNotificationPayload {
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  // Email configuration
  send_email?: boolean;
  email_template?: string;
}

interface LegacyNotificationPayload {
  user_id: string;
  type: 'like' | 'repost' | 'reply' | 'mention' | 'follow' | 'post';
  triggered_by_user_id: string;
  post_id?: string;
}

interface BatchNotificationPayload {
  notifications: MarketplaceNotificationPayload[];
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// Email templates for different notification types
const EMAIL_TEMPLATES: Record<string, { subject: string; body: (data: Record<string, unknown>) => string }> = {
  order_received: {
    subject: '🎉 New Order Received - Card Trader',
    body: (data) => `
      <h2>You've received a new order!</h2>
      <p>A buyer has purchased an item from your store.</p>
      ${data.card_name ? `<p><strong>Card:</strong> ${data.card_name}</p>` : ''}
      ${data.amount ? `<p><strong>Amount:</strong> $${data.amount}</p>` : ''}
      <p>Please ship the item within 3 business days to maintain your seller rating.</p>
      <p><a href="${data.link || 'https://cardtrader.app/seller/orders'}">View Order Details</a></p>
    `,
  },
  order_shipped: {
    subject: '📦 Your Order Has Shipped - Card Trader',
    body: (data) => `
      <h2>Great news! Your order is on its way!</h2>
      <p>The seller has shipped your item.</p>
      ${data.tracking_number ? `<p><strong>Tracking Number:</strong> ${data.tracking_number}</p>` : ''}
      ${data.card_name ? `<p><strong>Card:</strong> ${data.card_name}</p>` : ''}
      <p><a href="${data.link || 'https://cardtrader.app/orders'}">Track Your Order</a></p>
    `,
  },
  payment_received: {
    subject: '💰 Payment Received - Card Trader',
    body: (data) => `
      <h2>Payment Confirmed!</h2>
      <p>You've received a payment for your sale.</p>
      ${data.amount ? `<p><strong>Amount:</strong> $${data.amount}</p>` : ''}
      <p>The funds will be available in your account after the delivery is confirmed.</p>
      <p><a href="${data.link || 'https://cardtrader.app/seller/dashboard'}">View Dashboard</a></p>
    `,
  },
  review_received: {
    subject: '⭐ New Review Received - Card Trader',
    body: (data) => `
      <h2>You've received a new review!</h2>
      <p>A buyer has left feedback on their purchase.</p>
      ${data.rating ? `<p><strong>Rating:</strong> ${'⭐'.repeat(Number(data.rating))}</p>` : ''}
      ${data.comment ? `<p><strong>Comment:</strong> "${data.comment}"</p>` : ''}
      <p><a href="${data.link || 'https://cardtrader.app/seller/reviews'}">View All Reviews</a></p>
    `,
  },
  outbid: {
    subject: '🔔 You\'ve Been Outbid - Card Trader',
    body: (data) => `
      <h2>Another bidder has placed a higher bid!</h2>
      ${data.card_name ? `<p><strong>Card:</strong> ${data.card_name}</p>` : ''}
      ${data.current_bid ? `<p><strong>Current Bid:</strong> $${data.current_bid}</p>` : ''}
      <p>Place a new bid to stay in the auction!</p>
      <p><a href="${data.link || 'https://cardtrader.app/marketplace'}">View Auction</a></p>
    `,
  },
  auction_won: {
    subject: '🏆 Congratulations! You Won the Auction - Card Trader',
    body: (data) => `
      <h2>You won the auction!</h2>
      ${data.card_name ? `<p><strong>Card:</strong> ${data.card_name}</p>` : ''}
      ${data.winning_bid ? `<p><strong>Winning Bid:</strong> $${data.winning_bid}</p>` : ''}
      <p>Complete your payment to finalize the purchase.</p>
      <p><a href="${data.link || 'https://cardtrader.app/orders'}">Complete Payment</a></p>
    `,
  },
};

// ===========================
// HELPER FUNCTIONS
// ===========================

async function createNotificationRecord(
  supabaseClient: ReturnType<typeof createClient>,
  payload: MarketplaceNotificationPayload
) {
  const { data, error } = await supabaseClient
    .from('user_notifications')
    .insert({
      user_id: payload.user_id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      link: payload.link,
      metadata: payload.metadata || {},
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating notification record:', error);
    throw error;
  }

  return data;
}

async function sendEmailNotification(
  payload: MarketplaceNotificationPayload,
  userEmail: string
) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY');

  // Prefer Resend, fallback to SendGrid
  if (resendApiKey) {
    return sendViaResend(payload, userEmail, resendApiKey);
  } else if (sendgridApiKey) {
    return sendViaSendGrid(payload, userEmail, sendgridApiKey);
  } else {
    console.warn('No email API key configured. Skipping email notification.');
    return { success: false, reason: 'No email provider configured' };
  }
}

async function sendViaResend(
  payload: MarketplaceNotificationPayload,
  userEmail: string,
  apiKey: string
) {
  const template = EMAIL_TEMPLATES[payload.type];
  const subject = template?.subject || payload.title;
  const htmlBody = template?.body(payload.metadata || {}) || `
    <h2>${payload.title}</h2>
    <p>${payload.message}</p>
    ${payload.link ? `<p><a href="${payload.link}">View Details</a></p>` : ''}
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Card Trader <notifications@cardtrader.app>',
        to: [userEmail],
        subject,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return { success: false, error: errorData };
    }

    const data = await response.json();
    return { success: true, id: data.id };
  } catch (error) {
    console.error('Error sending email via Resend:', error);
    return { success: false, error };
  }
}

async function sendViaSendGrid(
  payload: MarketplaceNotificationPayload,
  userEmail: string,
  apiKey: string
) {
  const template = EMAIL_TEMPLATES[payload.type];
  const subject = template?.subject || payload.title;
  const htmlBody = template?.body(payload.metadata || {}) || `
    <h2>${payload.title}</h2>
    <p>${payload.message}</p>
    ${payload.link ? `<p><a href="${payload.link}">View Details</a></p>` : ''}
  `;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: userEmail }] }],
        from: { email: 'notifications@cardtrader.app', name: 'Card Trader' },
        subject,
        content: [{ type: 'text/html', value: htmlBody }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid API error:', errorText);
      return { success: false, error: errorText };
    }

    return { success: true };
  } catch (error) {
    console.error('Error sending email via SendGrid:', error);
    return { success: false, error };
  }
}

async function getUserEmail(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabaseClient.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) {
    console.warn('Could not retrieve user email:', error);
    return null;
  }
  return data.user.email;
}

async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; data?: Record<string, unknown> }
) {
  try {
    const webpush = await import('https://esm.sh/web-push@3.6.7');
    
    const vapidKeys = {
      subject: 'mailto:admin@cardtrader.app',
      publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    };

    if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
      console.warn('VAPID keys not configured');
      return { success: false, reason: 'VAPID keys not configured' };
    }

    webpush.setVapidDetails(
      vapidKeys.subject,
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        ...payload,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
      })
    );

    return { success: true };
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false, error };
  }
}

// ===========================
// MAIN HANDLER
// ===========================

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const requestBody = await req.json();
    const { subscription, notification, notifications, batch } = requestBody;

    // ===========================
    // Handle Push Subscription Storage
    // ===========================
    if (subscription) {
      const { data: { user } } = await supabaseClient.auth.getUser();

      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabaseClient.auth.updateUser({
        data: {
          push_subscription: subscription,
          push_subscription_updated: new Date().toISOString(),
        },
      });

      if (error) {
        console.error('Error storing push subscription:', error);
        return new Response(JSON.stringify({ error: 'Failed to store subscription' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===========================
    // Handle Batch Notifications
    // ===========================
    if (batch && notifications) {
      const batchPayload = requestBody as BatchNotificationPayload;
      const results = [];

      for (const notif of batchPayload.notifications) {
        try {
          // Create notification record
          const record = await createNotificationRecord(supabaseClient, notif);

          // Send email if requested
          let emailResult = null;
          if (notif.send_email !== false) {
            const userEmail = await getUserEmail(supabaseClient, notif.user_id);
            if (userEmail) {
              emailResult = await sendEmailNotification(notif, userEmail);
            }
          }

          results.push({
            notification_id: record.id,
            success: true,
            email_sent: emailResult?.success || false,
          });
        } catch (error) {
          console.error('Error processing batch notification:', error);
          results.push({
            notification_id: null,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===========================
    // Handle Single Marketplace Notification
    // ===========================
    if (notification) {
      const payload = notification as MarketplaceNotificationPayload | LegacyNotificationPayload;

      // Check if it's a marketplace notification (has title/message)
      if ('title' in payload && 'message' in payload) {
        const marketplacePayload = payload as MarketplaceNotificationPayload;

        // Create notification record in database
        const record = await createNotificationRecord(supabaseClient, marketplacePayload);

        // Send email notification
        let emailResult = null;
        if (marketplacePayload.send_email !== false) {
          const userEmail = await getUserEmail(supabaseClient, marketplacePayload.user_id);
          if (userEmail) {
            emailResult = await sendEmailNotification(marketplacePayload, userEmail);
          }
        }

        // Try to send push notification
        let pushResult = null;
        try {
          const { data: userData } = await supabaseClient.auth.admin.getUserById(
            marketplacePayload.user_id
          );
          if (userData?.user_metadata?.push_subscription) {
            pushResult = await sendPushNotification(
              userData.user_metadata.push_subscription,
              {
                title: marketplacePayload.title,
                body: marketplacePayload.message,
                data: {
                  type: marketplacePayload.type,
                  link: marketplacePayload.link,
                  notification_id: record.id,
                },
              }
            );
          }
        } catch (pushError) {
          console.warn('Push notification failed:', pushError);
        }

        return new Response(
          JSON.stringify({
            success: true,
            notification_id: record.id,
            email_sent: emailResult?.success || false,
            push_sent: pushResult?.success || false,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ===========================
      // Handle Legacy Social Notifications
      // ===========================
      const legacyPayload = payload as LegacyNotificationPayload;
      const { user_id, type, triggered_by_user_id, post_id } = legacyPayload;

      const { data: userData, error: userError } = await supabaseClient.auth.admin.getUserById(user_id);

      if (userError || !userData?.user_metadata?.push_subscription) {
        console.log('No push subscription found for user:', user_id);
        return new Response(JSON.stringify({ success: false, reason: 'No subscription' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: triggerUser } = await supabaseClient.auth.admin.getUserById(triggered_by_user_id);
      const triggerUsername = triggerUser?.user_metadata?.username || 'Someone';

      let title = 'Card Trader';
      let body = '';

      switch (type) {
        case 'like':
          title = `${triggerUsername} liked your post`;
          body = 'Check out what they liked!';
          break;
        case 'repost':
          title = `${triggerUsername} reposted your post`;
          body = 'Your post is getting attention!';
          break;
        case 'reply':
          title = `${triggerUsername} replied to your post`;
          body = 'See what they said';
          break;
        case 'mention':
          title = `${triggerUsername} mentioned you`;
          body = 'You were mentioned in a post';
          break;
        case 'follow':
          title = `${triggerUsername} followed you`;
          body = 'You have a new follower!';
          break;
        case 'post':
          title = `${triggerUsername} made a new post`;
          body = 'Check out their latest post';
          break;
      }

      const pushResult = await sendPushNotification(
        userData.user_metadata.push_subscription,
        {
          title,
          body,
          data: {
            type,
            post_id,
            triggered_by: triggered_by_user_id,
            url: post_id ? `/posts/${post_id}` : `/profile/${triggered_by_user_id}`,
          },
        }
      );

      return new Response(JSON.stringify(pushResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
